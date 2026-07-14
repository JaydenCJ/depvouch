# Contributing to depvouch

Issues, discussions and pull requests are all welcome — this project aims
to stay small, zero-dependency at runtime, and honest about what a vouch
does and does not prove.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/depvouch.git
cd depvouch
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 90 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (the init -> red -> vouch ->
green lifecycle, delta chains, import/export, prune, JSON output, exit
codes, determinism) against the bundled example repo and must print
`SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (parsing and resolution take plain values — only the CLI and
   the ledger loader touch the filesystem).
5. Changes to the ledger format need a section in
   `docs/ledger-format.md` and must keep `"version": 1` files loading
   unchanged.

## Ground rules

- **No runtime dependencies.** The zero-dependency install is a core
  feature of a supply-chain tool; adding one needs justification in the
  PR and will usually be declined. This repo dogfoods itself: its own
  `.depvouch/` ledger vouches for the single devDependency, and any new
  dependency must arrive with a vouch in the same commit.
- No network calls, ever — depvouch reads lockfiles and its own ledger,
  then prints. Even `import` only reads a local file the user names.
- Never weaken the gate silently: exemptions must stay visibly distinct
  from vouches, unknown criteria must fail loudly at load time, and
  version matching stays exact — no "close enough" coverage.
- Serialization must stay deterministic (sorted entries, stable key
  order) so ledger diffs remain reviewable.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `depvouch --version` output, the exact command line, the
relevant lockfile excerpt and ledger entries (or `depvouch check
--format json` output) that reproduce the problem. If you believe a
verdict is wrong, say which chain of vouches you expected to apply.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
