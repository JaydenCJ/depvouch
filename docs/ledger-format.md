# The `.depvouch/` ledger format

The ledger is three plain-JSON files, committed to the repo, designed so
every change is a small reviewable diff. All files are written sorted,
with stable key order and a trailing newline; `depvouch` never reformats
entries it did not touch.

## `config.json` — policy

```json
{
  "version": 1,
  "default-criteria": ["safe-to-deploy"],
  "dev-criteria": ["safe-to-run"],
  "criteria": {
    "crypto-reviewed": {
      "description": "Cryptographic code reviewed by a subject-matter expert.",
      "implies": ["safe-to-deploy"]
    }
  },
  "policy": {
    "npm:node-forge": { "criteria": ["crypto-reviewed"] }
  },
  "lockfiles": ["package-lock.json", "services/api/requirements.txt"]
}
```

| Key | Default | Effect |
|---|---|---|
| `version` | required | ledger format version; 0.1 reads `1` |
| `default-criteria` | `["safe-to-deploy"]` | criteria a production dependency must satisfy |
| `dev-criteria` | `["safe-to-run"]` | criteria a dev-only dependency must satisfy |
| `criteria` | `{}` | custom criteria; `implies` links them to weaker ones |
| `policy` | `{}` | per-package overrides, keyed `"npm:<name>"` / `"pypi:<name>"` |
| `lockfiles` | auto-discover | explicit repo-relative lockfile list |

Without `lockfiles`, depvouch discovers `package-lock.json`,
`requirements.txt`, `requirements-dev.txt` and `dev-requirements.txt` at
the repo root. `requirements` files containing `dev` mark their packages
as dev dependencies.

## `vouches.json` — this repo's judgment

```json
{
  "version": 1,
  "vouches": [
    {
      "ecosystem": "npm",
      "package": "minimist",
      "version": "1.2.6",
      "criteria": ["safe-to-deploy"],
      "by": "bob",
      "date": "2026-06-20",
      "note": "full read; prototype-pollution history checked"
    },
    {
      "ecosystem": "npm",
      "package": "minimist",
      "from": "1.2.6",
      "version": "1.2.8",
      "criteria": ["safe-to-deploy"],
      "by": "erin",
      "date": "2026-07-05"
    }
  ],
  "exemptions": [
    {
      "ecosystem": "pypi",
      "package": "typing-extensions",
      "version": "4.12.2",
      "note": "seeded by depvouch init on 2026-07-01"
    }
  ]
}
```

A vouch **without `from`** is a full review of `version`. A vouch **with
`from`** is a delta review of the `from -> version` diff; it certifies
`version` only through a chain that starts at a full vouch and whose
endpoints connect exactly. Every link must carry the required criterion,
directly or through `implies`.

Field rules: `ecosystem` is `npm` or `pypi`; `criteria` is a non-empty
array of known names; `by` and `date` (`YYYY-MM-DD`) are mandatory —
a review without a reviewer is not a review. Package names are matched
canonically (PEP 503 for PyPI), versions by exact canonical string:
depvouch never assumes `1.4` and `1.4.0` are the same release.

An **exemption** is a pass without judgment for one exact version.
`depvouch init` seeds one per pre-existing dependency; burn them down
with reviews and `depvouch prune`.

## `imports.json` — other repos' judgment

```json
{
  "version": 1,
  "sources": {
    "acme-security": {
      "imported": "2026-07-06",
      "vouches": [ { "ecosystem": "pypi", "package": "requests", "version": "2.32.3", "criteria": ["safe-to-deploy"], "by": "dana", "date": "2026-07-04" } ]
    }
  }
}
```

Written by `depvouch import <file> --as <name>`; the payload is exactly
what `depvouch export` prints (`{"version": 1, "vouches": [...]}`).
Imported vouches count toward the gate and reports show their origin.
`export` never includes exemptions or re-exports imports — a repo shares
only its own judgment, so provenance is never laundered.
