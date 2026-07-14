/**
 * The `check` orchestration: load the ledger, scan the lockfiles,
 * resolve every dependency and fold the verdicts into one report. This
 * is the function CI calls (via the CLI); it does no printing itself so
 * the same report can be rendered as text or JSON.
 */

import type { CheckReport, Ledger } from "./types.js";
import { buildCriteriaTable } from "./criteria.js";
import { scanLockfiles } from "./lockfiles.js";
import { loadLedger } from "./ledger.js";
import { resolveAll, type ResolveOptions } from "./resolve.js";

export interface CheckOptions extends ResolveOptions {}

/** Run the gate against a repo root. Throws `LedgerError` on broken inputs. */
export function runCheck(root: string, options: CheckOptions = {}): CheckReport {
  const ledger = loadLedger(root);
  return runCheckWithLedger(root, ledger, options);
}

/** Same, with a pre-loaded ledger (used by `prune` to re-check hypotheticals). */
export function runCheckWithLedger(
  root: string,
  ledger: Ledger,
  options: CheckOptions = {}
): CheckReport {
  const table = buildCriteriaTable(ledger.config.criteria);
  const scan = scanLockfiles(root, ledger.config.lockfiles);
  const results = resolveAll(scan.deps, ledger, table, options);

  let vouched = 0;
  let exempted = 0;
  let unvouched = 0;
  for (const r of results) {
    if (r.verdict.status === "vouched") vouched += 1;
    else if (r.verdict.status === "exempted") exempted += 1;
    else unvouched += 1;
  }
  const summary = {
    total: results.length,
    vouched,
    exempted,
    unvouched,
    problems: scan.problems.length,
  };
  return {
    files: scan.files,
    results,
    problems: scan.problems,
    summary,
    ok: unvouched === 0 && scan.problems.length === 0,
  };
}
