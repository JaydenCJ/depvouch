/**
 * The criteria model, borrowed from cargo-vet: a vouch certifies one or
 * more named criteria, and criteria can imply weaker ones (certifying
 * `safe-to-deploy` also certifies `safe-to-run`). Two criteria are built
 * in; projects add their own in `.depvouch/config.json`. The table is
 * validated up front — unknown names, redefined built-ins and implication
 * cycles are configuration errors, never silent surprises at gate time.
 */

import type { CriteriaDef } from "./types.js";
import { LedgerError } from "./errors.js";

export const BUILTIN_CRITERIA: Record<string, CriteriaDef> = {
  "safe-to-run": {
    description:
      "Reviewed enough to run in a development environment or CI: no malicious " +
      "behavior, no data exfiltration, install/build scripts inspected.",
    implies: [],
  },
  "safe-to-deploy": {
    description:
      "Reviewed for production use: safe-to-run, plus no vulnerabilities a " +
      "reviewer would be expected to catch, and sound handling of untrusted input.",
    implies: ["safe-to-run"],
  },
};

const NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Merge custom criteria over the built-ins and validate the result.
 * Throws `LedgerError` on invalid names, redefined built-ins, implications
 * pointing at unknown criteria, or implication cycles.
 */
export function buildCriteriaTable(
  custom: Record<string, CriteriaDef> = {}
): Record<string, CriteriaDef> {
  const table: Record<string, CriteriaDef> = { ...BUILTIN_CRITERIA };
  for (const [name, def] of Object.entries(custom)) {
    if (!NAME_RE.test(name)) {
      throw new LedgerError(
        `invalid criteria name \`${name}\` — use lowercase letters, digits and dashes`
      );
    }
    if (name in BUILTIN_CRITERIA) {
      throw new LedgerError(`criteria \`${name}\` is built in and cannot be redefined`);
    }
    table[name] = { description: def.description, implies: [...def.implies] };
  }
  for (const [name, def] of Object.entries(table)) {
    for (const target of def.implies) {
      if (!(target in table)) {
        throw new LedgerError(`criteria \`${name}\` implies unknown criteria \`${target}\``);
      }
    }
  }
  assertAcyclic(table);
  return table;
}

function assertAcyclic(table: Record<string, CriteriaDef>): void {
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string, trail: string[]): void => {
    const s = state.get(name);
    if (s === "done") return;
    if (s === "visiting") {
      throw new LedgerError(
        `criteria implication cycle: ${[...trail, name].join(" -> ")}`
      );
    }
    state.set(name, "visiting");
    for (const target of (table[name] as CriteriaDef).implies) {
      visit(target, [...trail, name]);
    }
    state.set(name, "done");
  };
  for (const name of Object.keys(table)) visit(name, []);
}

/** Every criterion certified by `names`, directly or through implication. */
export function closureOf(
  names: readonly string[],
  table: Record<string, CriteriaDef>
): Set<string> {
  const out = new Set<string>();
  const stack = [...names];
  while (stack.length > 0) {
    const name = stack.pop() as string;
    if (out.has(name)) continue;
    const def = table[name];
    if (def === undefined) continue; // unknown names never satisfy anything
    out.add(name);
    stack.push(...def.implies);
  }
  return out;
}

/** Does a vouch carrying `have` satisfy the single criterion `required`? */
export function satisfies(
  have: readonly string[],
  required: string,
  table: Record<string, CriteriaDef>
): boolean {
  return closureOf(have, table).has(required);
}

/** Validate that every name in `names` exists in the table. */
export function assertKnownCriteria(
  names: readonly string[],
  table: Record<string, CriteriaDef>,
  context: string
): void {
  for (const name of names) {
    if (!(name in table)) {
      const known = Object.keys(table).sort().join(", ");
      throw new LedgerError(`${context}: unknown criteria \`${name}\` (known: ${known})`);
    }
  }
  if (names.length === 0) {
    throw new LedgerError(`${context}: at least one criterion is required`);
  }
}
