/**
 * Suggestions: for every unvouched dependency, find the cheapest review
 * that would make `check` pass. If some already-certified version of the
 * package exists (a full vouch, or a version reachable through delta
 * chains), a delta review from the closest such base is proposed —
 * reviewing a diff is far cheaper than reviewing a whole package. The
 * closest base prefers the highest certified version below the target,
 * falling back to the lowest one above it.
 */

import type { CriteriaDef, Dep, SourcedVouch } from "./types.js";
import { canonicalVersion, compareVersions } from "./semverish.js";
import { chainFor, vouchesForPackage } from "./resolve.js";

export interface Suggestion {
  dep: Dep;
  /** Criteria the review must certify. */
  criteria: string[];
  /** Best delta base, or null when a full review is needed. */
  base: string | null;
  /** Ready-to-run vouch command. */
  command: string;
}

/** Versions of this package already certified for every criterion in `criteria`. */
export function certifiedVersions(
  dep: Dep,
  criteria: readonly string[],
  vouches: readonly SourcedVouch[],
  table: Record<string, CriteriaDef>
): string[] {
  const mine = vouchesForPackage(dep, vouches);
  const candidates = new Map<string, string>(); // canonical -> display form
  for (const v of mine) {
    const canon = canonicalVersion(v.version);
    if (!candidates.has(canon)) candidates.set(canon, v.version);
  }
  candidates.delete(canonicalVersion(dep.version));
  const out: string[] = [];
  for (const [, display] of candidates) {
    const ok = criteria.every((c) => chainFor(display, c, mine, table) !== null);
    if (ok) out.push(display);
  }
  return out.sort(compareVersions);
}

/** Pick the closest certified base for a delta review, or null. */
export function pickBase(target: string, certified: readonly string[]): string | null {
  let below: string | null = null;
  let above: string | null = null;
  for (const v of certified) {
    const cmp = compareVersions(v, target);
    if (cmp < 0 && (below === null || compareVersions(v, below) > 0)) below = v;
    if (cmp > 0 && (above === null || compareVersions(v, above) < 0)) above = v;
  }
  return below ?? above;
}

/** Build the suggestion for one unvouched dependency. */
export function suggestFor(
  dep: Dep,
  missing: readonly string[],
  vouches: readonly SourcedVouch[],
  table: Record<string, CriteriaDef>
): Suggestion {
  const criteria = [...missing];
  const certified = certifiedVersions(dep, criteria, vouches, table);
  const base = pickBase(dep.version, certified);
  const parts = [
    `depvouch vouch ${dep.name}@${dep.version}`,
    `--eco ${dep.ecosystem}`,
  ];
  if (base !== null) parts.push(`--from ${base}`);
  parts.push(`--criteria ${criteria.join(",")}`, "--by <you>");
  return { dep, criteria, base, command: parts.join(" ") };
}
