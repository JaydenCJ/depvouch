/**
 * `depvouch explain <topic>` — the offline manual. Every concept a
 * reviewer meets in a failed gate is documented here, so nobody needs a
 * network connection (or this repo's README) to understand what the tool
 * is asking of them.
 */

import { BUILTIN_CRITERIA } from "./criteria.js";

const TOPICS: Record<string, string> = {
  criteria: [
    "Criteria are the named standards a review certifies. Built in:",
    "",
    ...Object.entries(BUILTIN_CRITERIA).map(
      ([name, def]) =>
        `  ${name}${def.implies.length > 0 ? ` (implies ${def.implies.join(", ")})` : ""}\n      ${def.description}`
    ),
    "",
    "Projects define stricter criteria in .depvouch/config.json under `criteria`,",
    'e.g. `"crypto-reviewed": {"description": "…", "implies": ["safe-to-deploy"]}`.',
    "A vouch for a criterion also satisfies everything that criterion implies.",
    "Which criteria a dependency must meet comes from `default-criteria`",
    "(production deps), `dev-criteria` (dev-only deps), or a per-package",
    '`policy` entry keyed `"npm:<name>"` / `"pypi:<name>"`.',
  ].join("\n"),

  delta: [
    "A delta vouch records that a human reviewed the *diff* between two",
    "versions, not the whole package: `depvouch vouch pkg@1.4.0 --from 1.3.2`.",
    "Deltas only count when they chain back to a full vouch with matching",
    "endpoints: full 1.3.0 + delta 1.3.0 -> 1.3.2 + delta 1.3.2 -> 1.4.0",
    "certifies 1.4.0. Every link in the chain must carry the required",
    "criterion (directly or by implication). Version matching is exact —",
    "depvouch never assumes 1.4 and 1.4.0 are the same release.",
  ].join("\n"),

  exemptions: [
    "An exemption is a pass without judgment: the exact package version is",
    "allowed through the gate, and nothing is claimed about its safety.",
    "`depvouch init` seeds one exemption per pre-existing dependency so the",
    "gate starts green and only new additions demand review. Burn them down",
    "over time: review a package, vouch for it, then run `depvouch prune`",
    "to drop exemptions that vouches now cover. `check --no-exemptions`",
    "shows what coverage looks like without them.",
  ].join("\n"),

  imports: [
    "Vouches are shareable evidence. `depvouch export` prints this repo's",
    "own vouches (never its exemptions, never re-exported imports — you",
    "share only your own judgment). Another repo stores that file with",
    "`depvouch import team-vouches.json --as <source-name>`; imported",
    "vouches then count toward its gate and reports show their origin.",
    "Imports live in .depvouch/imports.json and are refreshed by",
    "re-importing under the same name. depvouch never fetches anything —",
    "moving the file (commit, artifact, plain copy) is up to you.",
  ].join("\n"),

  ledger: [
    "The ledger lives in .depvouch/ and is meant to be committed:",
    "",
    "  config.json    policy — required criteria, custom criteria,",
    "                 per-package overrides, explicit lockfile list",
    "  vouches.json   this repo's reviews (vouches) and exemptions",
    "  imports.json   vouch sets imported from other repos, by source",
    "",
    "Files are plain sorted JSON so ledger changes show up as small,",
    "reviewable diffs. Lockfiles read in 0.1: package-lock.json (v1-v3)",
    "and requirements*.txt (exact `==` pins).",
  ].join("\n"),

  "exit-codes": [
    "0  check passed — every locked dependency is vouched or exempted",
    "1  check failed — unvouched dependencies, or lockfile problems such",
    "   as unpinned requirements and non-registry sources",
    "2  usage error, broken ledger, or unreadable input — the run itself",
    "   was invalid, so a pipeline can tell 'bad deps' from 'bad setup'",
  ].join("\n"),
};

export function explainTopic(topic: string): string | null {
  const text = TOPICS[topic];
  return text === undefined ? null : text + "\n";
}

export const EXPLAIN_TOPICS = Object.keys(TOPICS).sort();
