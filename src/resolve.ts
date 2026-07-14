/**
 * The heart of depvouch: deciding whether one locked dependency is
 * covered by the ledger. A dependency passes a criterion when there is a
 * **certification chain** — a full vouch at some version, followed by
 * zero or more delta vouches whose endpoints connect exactly, ending at
 * the locked version — where every link certifies that criterion
 * (directly or through implication). Chains are found by breadth-first
 * search backwards from the target, so the shortest chain is reported.
 * Exemptions are checked only after vouching fails: an exemption is a
 * pass, never a review.
 */

import type {
  CriteriaDef,
  Dep,
  DepResult,
  Exemption,
  ImportSource,
  Ledger,
  LedgerConfig,
  SourcedVouch,
  Verdict,
} from "./types.js";
import { canonicalName, canonicalVersion } from "./semverish.js";
import { closureOf } from "./criteria.js";

/** Flatten own + imported vouches into one list tagged with origin. */
export function allVouches(ledger: Ledger): SourcedVouch[] {
  const out: SourcedVouch[] = ledger.vouches.map((v) => ({ ...v, origin: null }));
  for (const name of Object.keys(ledger.imports).sort()) {
    for (const v of (ledger.imports[name] as ImportSource).vouches) {
      out.push({ ...v, origin: name });
    }
  }
  return out;
}

/** The criteria this dependency must satisfy, per config policy. */
export function requiredCriteriaFor(dep: Dep, config: LedgerConfig): string[] {
  const key = `${dep.ecosystem}:${canonicalName(dep.ecosystem, dep.name)}`;
  const override = config.policy[key];
  if (override !== undefined) return [...override.criteria];
  return dep.dev ? [...config.devCriteria] : [...config.defaultCriteria];
}

/** Vouches for one canonical package, regardless of origin. */
export function vouchesForPackage(
  dep: { ecosystem: "npm" | "pypi"; name: string },
  vouches: readonly SourcedVouch[]
): SourcedVouch[] {
  const key = canonicalName(dep.ecosystem, dep.name);
  return vouches.filter(
    (v) => v.ecosystem === dep.ecosystem && canonicalName(v.ecosystem, v.package) === key
  );
}

/**
 * Find the shortest certification chain that proves `criterion` for
 * `targetVersion`, or null. The returned array is ordered full-vouch
 * first, then each delta in application order.
 */
export function chainFor(
  targetVersion: string,
  criterion: string,
  packageVouches: readonly SourcedVouch[],
  table: Record<string, CriteriaDef>
): SourcedVouch[] | null {
  const eligible = packageVouches.filter((v) => closureOf(v.criteria, table).has(criterion));
  const fulls = new Map<string, SourcedVouch>();
  const deltasTo = new Map<string, SourcedVouch[]>();
  for (const v of eligible) {
    const to = canonicalVersion(v.version);
    if (v.from === undefined) {
      if (!fulls.has(to)) fulls.set(to, v);
    } else {
      const list = deltasTo.get(to) ?? [];
      list.push(v);
      deltasTo.set(to, list);
    }
  }

  const start = canonicalVersion(targetVersion);
  const direct = fulls.get(start);
  if (direct !== undefined) return [direct];

  // BFS backwards through delta edges until a fully-vouched version is reached.
  const visited = new Set<string>([start]);
  const queue: Array<{ version: string; path: SourcedVouch[] }> = [{ version: start, path: [] }];
  while (queue.length > 0) {
    const { version, path } = queue.shift() as { version: string; path: SourcedVouch[] };
    for (const delta of deltasTo.get(version) ?? []) {
      const prev = canonicalVersion(delta.from as string);
      if (visited.has(prev)) continue;
      const nextPath = [delta, ...path];
      const full = fulls.get(prev);
      if (full !== undefined) return [full, ...nextPath];
      visited.add(prev);
      queue.push({ version: prev, path: nextPath });
    }
  }
  return null;
}

/** Resolve one dependency against the ledger. */
export function resolveDep(
  dep: Dep,
  required: readonly string[],
  vouches: readonly SourcedVouch[],
  table: Record<string, CriteriaDef>,
  exemptions: readonly Exemption[]
): Verdict {
  const mine = vouchesForPackage(dep, vouches);
  const used: SourcedVouch[] = [];
  const missing: string[] = [];
  const satisfied: string[] = [];
  for (const criterion of required) {
    const chain = chainFor(dep.version, criterion, mine, table);
    if (chain === null) {
      missing.push(criterion);
      continue;
    }
    satisfied.push(criterion);
    for (const v of chain) {
      if (!used.includes(v)) used.push(v);
    }
  }
  if (missing.length === 0) return { status: "vouched", via: used };

  const depName = canonicalName(dep.ecosystem, dep.name);
  const depVersion = canonicalVersion(dep.version);
  const exemption = exemptions.find(
    (e) =>
      e.ecosystem === dep.ecosystem &&
      canonicalName(e.ecosystem, e.package) === depName &&
      canonicalVersion(e.version) === depVersion
  );
  if (exemption !== undefined) return { status: "exempted", exemption };
  return { status: "unvouched", missing, satisfied };
}

export interface ResolveOptions {
  /** Treat exemptions as if they were absent (`check --no-exemptions`). */
  ignoreExemptions?: boolean;
}

/** Resolve a whole dependency set. Results keep the input order. */
export function resolveAll(
  deps: readonly Dep[],
  ledger: Ledger,
  table: Record<string, CriteriaDef>,
  options: ResolveOptions = {}
): DepResult[] {
  const vouches = allVouches(ledger);
  const exemptions = options.ignoreExemptions === true ? [] : ledger.exemptions;
  return deps.map((dep) => {
    const required = requiredCriteriaFor(dep, ledger.config);
    return { dep, required, verdict: resolveDep(dep, required, vouches, table, exemptions) };
  });
}
