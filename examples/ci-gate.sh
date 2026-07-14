#!/usr/bin/env bash
# Minimal CI gate: fail the build when a locked dependency has no vouch.
# Usage: bash examples/ci-gate.sh [repo-root]
set -euo pipefail

ROOT="${1:-.}"

if ! depvouch check "$ROOT"; then
  echo
  echo "Unreviewed dependencies detected. Record the missing reviews:"
  depvouch suggest "$ROOT"
  exit 1
fi
