# depvouch examples

## `webapp/` — a repo mid-review

A small project using npm (`package-lock.json`) and PyPI
(`requirements.txt`) with a partially filled ledger:

| Dependency | Ledger state |
|---|---|
| `npm:express@4.19.2` | fully vouched by alice |
| `npm:accepts@1.3.8` | fully vouched by alice |
| `npm:prettier@3.3.2` (dev) | vouched `safe-to-run` by bob — enough, dev deps use `dev-criteria` |
| `npm:minimist@1.2.8` | **unvouched** — but `1.2.6` is vouched, so a cheap delta review is suggested |
| `pypi:flask@3.0.3` | fully vouched by carol |
| `pypi:requests@2.32.3` | **unvouched** — no prior version, full review needed |
| `pypi:typing-extensions@4.12.2` | exempted (seeded by `depvouch init`) |

Run the gate and watch it fail with copy-paste fixes:

```bash
node dist/cli.js check examples/webapp        # exit 1, 2 unvouched
node dist/cli.js suggest examples/webapp      # the cheapest path to full coverage
```

## `org-vouches.json` — shared reviews from another repo

The file another team produced with `depvouch export`: a delta review of
`minimist 1.2.6 -> 1.2.8` and a full review of `requests@2.32.3`. Import
it (into a scratch copy, to keep this example failing for the next
reader) and the gate goes green — reviews done once, reused everywhere:

```bash
WORK="$(mktemp -d)" && cp -r examples/webapp/. "$WORK"
node dist/cli.js import examples/org-vouches.json --as acme-security --dir "$WORK"
node dist/cli.js check "$WORK"                # exit 0, provenance shown in --format json
rm -rf "$WORK"
```

## `ci-gate.sh` — the one-liner for your pipeline

Copy it into any CI job. It runs `depvouch check`, prints the report,
and fails the build on unreviewed additions; the `suggest` output tells
the author exactly which review to record.
