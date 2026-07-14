/**
 * Public programmatic API. Everything the CLI does is reachable from
 * code: parse lockfiles, load and save ledgers, resolve dependencies
 * against vouches, and render reports.
 */

export { VERSION } from "./version.js";
export type {
  CheckReport,
  CriteriaDef,
  Dep,
  DepResult,
  Ecosystem,
  Exemption,
  ImportSource,
  Ledger,
  LedgerConfig,
  LockfileInfo,
  SourcedVouch,
  Verdict,
  Vouch,
} from "./types.js";
export { ECOSYSTEMS, isEcosystem } from "./types.js";
export { UsageError, LedgerError } from "./errors.js";
export { canonicalName, canonicalVersion, compareVersions, looksLikeExactVersion } from "./semverish.js";
export { BUILTIN_CRITERIA, buildCriteriaTable, closureOf, satisfies } from "./criteria.js";
export { parseNpmLock, type ParsedLockfile } from "./npmlock.js";
export { parseRequirements, type PipParseOptions } from "./pipreqs.js";
export { scanLockfiles, classifyLockfile, type LockfileScan } from "./lockfiles.js";
export {
  LEDGER_DIR,
  initLedger,
  ledgerExists,
  loadLedger,
  saveImports,
  saveVouches,
  sortVouches,
} from "./ledger.js";
export {
  allVouches,
  chainFor,
  requiredCriteriaFor,
  resolveAll,
  resolveDep,
  vouchesForPackage,
} from "./resolve.js";
export { certifiedVersions, pickBase, suggestFor, type Suggestion } from "./suggest.js";
export { runCheck, runCheckWithLedger } from "./check.js";
export {
  renderCheckJson,
  renderCheckText,
  renderList,
  renderSuggestText,
  suggestionsFor,
} from "./report.js";
export { parseSpec, parseArgs, type Command, type PackageSpec } from "./cliargs.js";
export { explainTopic, EXPLAIN_TOPICS } from "./explain.js";
