/**
 * Core data model shared by every module: dependencies extracted from
 * lockfiles, the ledger entries humans write (vouches, exemptions,
 * imports), the policy configuration, and the verdicts `check` produces.
 * Everything here is plain data — no methods, no I/O — so the resolution
 * engine stays pure and unit-testable.
 */

export const ECOSYSTEMS = ["npm", "pypi"] as const;
export type Ecosystem = (typeof ECOSYSTEMS)[number];

export function isEcosystem(v: unknown): v is Ecosystem {
  return typeof v === "string" && (ECOSYSTEMS as readonly string[]).includes(v);
}

/** One locked dependency, as extracted from a lockfile. */
export interface Dep {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  /** True when the lockfile marks the package as development-only. */
  dev: boolean;
  /** Repo-relative lockfile path(s) the dependency was found in. */
  sources: string[];
}

/**
 * One human review record. A vouch without `from` is a **full vouch**:
 * the reviewer read the package at `version`. A vouch with `from` is a
 * **delta vouch**: the reviewer read the diff `from` -> `version`, and it
 * only certifies `version` when chained back to a full vouch.
 */
export interface Vouch {
  ecosystem: Ecosystem;
  package: string;
  version: string;
  from?: string;
  criteria: string[];
  by: string;
  /** ISO date (YYYY-MM-DD) the review was recorded. */
  date: string;
  note?: string;
}

/** A vouch plus where it came from: `null` = this repo, else the import source name. */
export interface SourcedVouch extends Vouch {
  origin: string | null;
}

/**
 * A temporary pass for one exact package version — no human judgment
 * implied. `depvouch init` seeds one per pre-existing dependency so the
 * gate starts green and only *new* additions require review.
 */
export interface Exemption {
  ecosystem: Ecosystem;
  package: string;
  version: string;
  note?: string;
}

/** A named criterion a reviewer can certify. */
export interface CriteriaDef {
  description: string;
  /** Certifying this criterion also certifies every listed one. */
  implies: string[];
}

/** Parsed `.depvouch/config.json`. */
export interface LedgerConfig {
  /** Criteria a regular dependency must satisfy. */
  defaultCriteria: string[];
  /** Criteria a dev-only dependency must satisfy. */
  devCriteria: string[];
  /** Custom criteria, merged over the built-ins. */
  criteria: Record<string, CriteriaDef>;
  /** Per-package overrides, keyed `"<ecosystem>:<name>"`. */
  policy: Record<string, { criteria: string[] }>;
  /** Explicit lockfile list (repo-relative). Empty = auto-discover. */
  lockfiles: string[];
}

/** One imported vouch set, kept verbatim under its source name. */
export interface ImportSource {
  imported: string;
  vouches: Vouch[];
}

/** The whole ledger, as loaded from `.depvouch/`. */
export interface Ledger {
  config: LedgerConfig;
  vouches: Vouch[];
  exemptions: Exemption[];
  imports: Record<string, ImportSource>;
}

/** Why a dependency passed, or what it is missing. */
export type Verdict =
  | { status: "vouched"; via: SourcedVouch[] }
  | { status: "exempted"; exemption: Exemption }
  | { status: "unvouched"; missing: string[]; satisfied: string[] };

/** One dependency with its verdict and the criteria it was held to. */
export interface DepResult {
  dep: Dep;
  required: string[];
  verdict: Verdict;
}

/** A lockfile that was parsed, for the report header. */
export interface LockfileInfo {
  path: string;
  ecosystem: Ecosystem;
  count: number;
}

/** The full outcome of `depvouch check`. */
export interface CheckReport {
  files: LockfileInfo[];
  results: DepResult[];
  /** Lockfile-level problems (unpinned specs, non-registry sources, …). */
  problems: string[];
  summary: {
    total: number;
    vouched: number;
    exempted: number;
    unvouched: number;
    problems: number;
  };
  ok: boolean;
}
