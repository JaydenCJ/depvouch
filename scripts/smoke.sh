#!/usr/bin/env bash
# Smoke test for depvouch: exercises the real CLI end to end against the
# bundled example repo and a freshly seeded temp repo. No network,
# idempotent, runs from a clean checkout (after `npm install`).
# Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents the surface.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in init check vouch exempt suggest import export prune explain --criteria --from "Exit codes"; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Usage errors exit 2 (distinct from the gate's exit 1).
set +e
$CLI --frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI check "$WORKDIR/does-not-exist" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing ledger should exit 2"; }
$CLI explain nonsense >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown explain topic should exit 2"; }
$CLI vouch left-pad@1.3.0 --dir "$WORKDIR" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "vouch without a ledger should exit 2"; }
set -e
echo "[smoke] error handling ok (exit 2)"

# 4. The bundled example fails with the seeded unvouched deps and a delta suggestion.
set +e
EX_OUT="$($CLI check examples/webapp)"; EX_CODE=$?
set -e
[ "$EX_CODE" -eq 1 ] || fail "examples/webapp should exit 1, got $EX_CODE"
echo "$EX_OUT" | grep -q 'UNVOUCHED (2)' || fail "example should have 2 unvouched"
echo "$EX_OUT" | grep -q 'minimist@1.2.8 — missing safe-to-deploy' || fail "missing minimist finding"
echo "$EX_OUT" | grep -q 'nearest certified version: 1.2.6' || fail "missing delta suggestion"
echo "$EX_OUT" | grep -q 'FAIL — 2 unvouched (4 vouched, 1 exempted, 2 unvouched)' || fail "example verdict wrong"
echo "[smoke] example gate ok (exit 1, delta suggested)"

# 5. Importing the shared org vouches turns the example green (in a scratch copy).
cp -r "$ROOT/examples/webapp/." "$WORKDIR/webapp"
$CLI import "$ROOT/examples/org-vouches.json" --as acme-security --dir "$WORKDIR/webapp" >/dev/null \
  || fail "import failed"
$CLI check "$WORKDIR/webapp" >/dev/null || fail "example should pass after import"
$CLI check "$WORKDIR/webapp" --format json | grep -q '"origin": "acme-security"' \
  || fail "imported provenance missing from JSON"
echo "[smoke] cross-repo import ok (gate green, provenance kept)"

# 6. Full lifecycle on a fresh repo: init -> green -> new dep -> red -> vouch -> green.
mkdir -p "$WORKDIR/proj"
cat > "$WORKDIR/proj/package-lock.json" <<'EOF'
{"name":"proj","version":"1.0.0","lockfileVersion":3,
 "packages":{"":{"name":"proj","version":"1.0.0"},
             "node_modules/left-pad":{"version":"1.3.0"}}}
EOF
$CLI init "$WORKDIR/proj" | grep -q '1 existing dependency exempted' || fail "init seeding wrong"
$CLI check "$WORKDIR/proj" >/dev/null || fail "gate should start green after init"
cat > "$WORKDIR/proj/package-lock.json" <<'EOF'
{"name":"proj","version":"1.0.0","lockfileVersion":3,
 "packages":{"":{"name":"proj","version":"1.0.0"},
             "node_modules/left-pad":{"version":"1.3.0"},
             "node_modules/lodash":{"version":"4.17.21"}}}
EOF
set +e
$CLI check "$WORKDIR/proj" >/dev/null 2>&1; [ $? -eq 1 ] || { set -e; fail "new dep should fail the gate"; }
set -e
$CLI vouch lodash@4.17.21 --by alice --date 2026-07-13 --dir "$WORKDIR/proj" >/dev/null \
  || fail "vouch failed"
$CLI check "$WORKDIR/proj" >/dev/null || fail "gate should pass after the vouch"
echo "[smoke] lifecycle ok (init -> red -> vouch -> green)"

# 7. Delta chains: vouch a base version, then only the diff.
$CLI vouch left-pad@1.3.0 --by bob --date 2026-07-13 --dir "$WORKDIR/proj" >/dev/null
cat > "$WORKDIR/proj/package-lock.json" <<'EOF'
{"name":"proj","version":"1.0.0","lockfileVersion":3,
 "packages":{"":{"name":"proj","version":"1.0.0"},
             "node_modules/left-pad":{"version":"1.3.1"},
             "node_modules/lodash":{"version":"4.17.21"}}}
EOF
$CLI suggest "$WORKDIR/proj" | grep -q 'delta review 1.3.0 -> 1.3.1' || fail "delta suggestion missing"
$CLI vouch left-pad@1.3.1 --from 1.3.0 --by bob --date 2026-07-13 --dir "$WORKDIR/proj" >/dev/null
$CLI check "$WORKDIR/proj" >/dev/null || fail "delta chain should satisfy the gate"
echo "[smoke] delta chain ok"

# 8. Prune drops the now-covered init exemption.
$CLI prune "$WORKDIR/proj" | grep -q 'dropped 1 exemption, 0 remaining' || fail "prune wrong"
$CLI check "$WORKDIR/proj" --no-exemptions >/dev/null || fail "coverage should be real, not exempted"
echo "[smoke] prune ok (exemptions burned down)"

# 9. Export/import round-trip preserves the vouch count.
$CLI export "$WORKDIR/proj" > "$WORKDIR/shared.json"
grep -q '"version": 1' "$WORKDIR/shared.json" || fail "export shape wrong"
COUNT="$(node -p "JSON.parse(require('fs').readFileSync('$WORKDIR/shared.json','utf8')).vouches.length")"
[ "$COUNT" = "3" ] || fail "export should contain 3 vouches, got $COUNT"
echo "[smoke] export ok ($COUNT vouches)"

# 10. JSON output is valid JSON with the stable shape.
$CLI check "$WORKDIR/proj" --format json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.ok!==true||j.summary.vouched!==2)throw new Error('bad shape')})" \
  || fail "--format json shape wrong"
echo "[smoke] JSON output ok"

# 11. explain works offline for every topic.
for topic in criteria delta exemptions imports ledger exit-codes; do
  $CLI explain "$topic" >/dev/null || fail "explain $topic failed"
done
$CLI explain criteria | grep -q 'safe-to-deploy' || fail "explain criteria content wrong"
echo "[smoke] explain ok"

# 12. Determinism: two runs over the same tree are byte-identical.
$CLI check examples/webapp > "$WORKDIR/run1.txt" 2>/dev/null || true
$CLI check examples/webapp > "$WORKDIR/run2.txt" 2>/dev/null || true
cmp -s "$WORKDIR/run1.txt" "$WORKDIR/run2.txt" || fail "repeat runs differ"
echo "[smoke] determinism ok"

echo "SMOKE OK"
