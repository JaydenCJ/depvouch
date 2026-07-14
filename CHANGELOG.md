# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- `.depvouch/` ledger: `config.json` (policy), `vouches.json` (this
  repo's reviews and exemptions) and `imports.json` (vouch sets from
  other repos) — plain sorted JSON, written deterministically so every
  ledger change is a small reviewable diff.
- `depvouch check`: the CI gate. Reads `package-lock.json` (lockfile
  versions 1-3, workspace/link entries skipped, `npm:` aliases resolved)
  and `requirements*.txt` (comments, continuations, hashes, markers,
  extras, `-r` includes with cycle guard), then verifies every locked
  dependency against the ledger. Unpinned requirements and non-registry
  sources (git/URL/path pins) fail the gate as problems.
- Criteria model borrowed from cargo-vet: built-in `safe-to-run` and
  `safe-to-deploy` (which implies it), custom criteria with `implies`
  chains, per-package `policy` overrides and separate `dev-criteria`
  for development-only dependencies.
- Delta vouches: record a review of the `from -> version` diff;
  certification chains (full vouch + connecting deltas, every link
  carrying the required criterion) are resolved by shortest-path search.
- `depvouch init`: seeds one exemption per pre-existing dependency so
  the gate starts green and only new additions require review;
  `exempt`, `prune` (with `--dry-run`) and `check --no-exemptions`
  manage the burn-down.
- Cross-repo sharing: `export` prints this repo's own vouches (never
  exemptions, never re-exported imports), `import --as <name>` stores
  them under a named source, and reports show the provenance of every
  imported vouch.
- `depvouch suggest`: the cheapest path to full coverage — a delta
  review from the closest certified version when one exists, a full
  review otherwise, each with a copy-paste `vouch` command.
- CLI surface: `init`, `check` (default), `vouch`, `exempt`, `list`,
  `suggest`, `import`, `export`, `prune`, `explain` (offline docs for
  criteria, delta, exemptions, imports, ledger, exit-codes);
  `--format json` with a stable shape; exit codes 0 (pass) / 1 (gate
  failure) / 2 (usage or input error).
- Public programmatic API (lockfile parsers, ledger I/O, resolution
  engine, suggestions, renderers) with type declarations.
- Test suite: 90 node:test tests (unit + CLI integration in fresh temp
  dirs) and an end-to-end `scripts/smoke.sh` against the bundled
  example repo.

[0.1.0]: https://github.com/JaydenCJ/depvouch/releases/tag/v0.1.0
