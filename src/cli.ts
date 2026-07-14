#!/usr/bin/env node
/**
 * CLI entry point: parse arguments, dispatch to the pure engine, print,
 * and map outcomes to exit codes (0 pass, 1 gate failure, 2 usage or
 * input error). All decisions live in the imported modules; this file
 * only touches process state.
 */

import { parseArgs, HELP, type Command } from "./cliargs.js";
import { UsageError, LedgerError } from "./errors.js";
import { VERSION } from "./version.js";
import type { Ecosystem, Exemption, Vouch } from "./types.js";
import { runCheckWithLedger } from "./check.js";
import {
  initLedger,
  loadLedger,
  parseVouchArray,
  saveImports,
  saveVouches,
  sortVouches,
} from "./ledger.js";
import { scanLockfiles } from "./lockfiles.js";
import { buildCriteriaTable, assertKnownCriteria } from "./criteria.js";
import { canonicalName, canonicalVersion, looksLikeExactVersion } from "./semverish.js";
import { countNoun, renderCheckJson, renderCheckText, renderList, renderSuggestText, suggestionsFor } from "./report.js";
import { explainTopic, EXPLAIN_TOPICS } from "./explain.js";
import fs from "node:fs";
import path from "node:path";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function print(text: string): void {
  process.stdout.write(text);
}

/** Infer the ecosystem of a package name from the repo's lockfiles. */
function inferEcosystem(root: string, lockfiles: string[], name: string): Ecosystem {
  const scan = scanLockfiles(root, lockfiles);
  const hits = new Set<Ecosystem>();
  for (const dep of scan.deps) {
    if (canonicalName(dep.ecosystem, dep.name) === canonicalName(dep.ecosystem, name)) {
      hits.add(dep.ecosystem);
    }
  }
  if (hits.size === 1) return [...hits][0] as Ecosystem;
  if (hits.size === 0) {
    throw new UsageError(
      `\`${name}\` is not in any lockfile — pass --eco npm or --eco pypi to record it anyway`
    );
  }
  throw new UsageError(`\`${name}\` exists in more than one ecosystem — pass --eco to disambiguate`);
}

function runVouch(cmd: Command & { kind: "vouch" }): number {
  const ledger = loadLedger(cmd.root);
  const table = buildCriteriaTable(ledger.config.criteria);
  const eco = cmd.eco ?? inferEcosystem(cmd.root, ledger.config.lockfiles, cmd.spec.name);
  const criteria = cmd.criteria ?? [...ledger.config.defaultCriteria];
  assertKnownCriteria(criteria, table, "--criteria");
  if (cmd.by === null || cmd.by.trim() === "") {
    throw new UsageError("vouch needs --by <reviewer> — the ledger records *who* reviewed");
  }
  if (!looksLikeExactVersion(cmd.spec.version)) {
    throw new UsageError(`\`${cmd.spec.version}\` does not look like an exact version`);
  }
  if (cmd.from !== null) {
    if (!looksLikeExactVersion(cmd.from)) {
      throw new UsageError(`--from \`${cmd.from}\` does not look like an exact version`);
    }
    if (canonicalVersion(cmd.from) === canonicalVersion(cmd.spec.version)) {
      throw new UsageError("--from equals the vouched version — a delta must change versions");
    }
  }
  const date = cmd.date ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UsageError("--date must be YYYY-MM-DD");

  const vouch: Vouch = {
    ecosystem: eco,
    package: canonicalName(eco, cmd.spec.name),
    version: cmd.spec.version,
    criteria,
    by: cmd.by.trim(),
    date,
  };
  if (cmd.from !== null) vouch.from = cmd.from;
  if (cmd.note !== null) vouch.note = cmd.note;

  const duplicate = ledger.vouches.find(
    (v) =>
      v.ecosystem === vouch.ecosystem &&
      v.package === vouch.package &&
      canonicalVersion(v.version) === canonicalVersion(vouch.version) &&
      (v.from === undefined ? undefined : canonicalVersion(v.from)) ===
        (vouch.from === undefined ? undefined : canonicalVersion(vouch.from)) &&
      v.by === vouch.by &&
      [...v.criteria].sort().join(",") === [...criteria].sort().join(",")
  );
  if (duplicate !== undefined) {
    throw new UsageError(
      `an identical vouch by ${vouch.by} already exists for ${eco}:${vouch.package}@${vouch.version}`
    );
  }

  saveVouches(cmd.root, sortVouches([...ledger.vouches, vouch]), ledger.exemptions);
  const kind = vouch.from !== undefined ? `delta vouch (${vouch.from} -> ${vouch.version})` : `full vouch`;
  print(
    `depvouch: recorded ${kind} for ${eco}:${vouch.package}@${vouch.version} — ${criteria.join(", ")} — by ${vouch.by}\n`
  );

  const scan = scanLockfiles(cmd.root, ledger.config.lockfiles);
  const inLock = scan.deps.some(
    (d) =>
      d.ecosystem === eco &&
      canonicalName(d.ecosystem, d.name) === vouch.package &&
      canonicalVersion(d.version) === canonicalVersion(vouch.version)
  );
  if (!inLock) {
    print(`note: ${vouch.package}@${vouch.version} is not in the current lockfiles — recorded anyway\n`);
  }
  return 0;
}

function runExempt(cmd: Command & { kind: "exempt" }): number {
  const ledger = loadLedger(cmd.root);
  const eco = cmd.eco ?? inferEcosystem(cmd.root, ledger.config.lockfiles, cmd.spec.name);
  const exemption: Exemption = {
    ecosystem: eco,
    package: canonicalName(eco, cmd.spec.name),
    version: cmd.spec.version,
  };
  if (cmd.note !== null) exemption.note = cmd.note;
  const exists = ledger.exemptions.some(
    (e) =>
      e.ecosystem === eco &&
      canonicalName(e.ecosystem, e.package) === exemption.package &&
      canonicalVersion(e.version) === canonicalVersion(exemption.version)
  );
  if (exists) {
    throw new UsageError(`${eco}:${exemption.package}@${exemption.version} is already exempted`);
  }
  saveVouches(cmd.root, ledger.vouches, [...ledger.exemptions, exemption]);
  print(
    `depvouch: exempted ${eco}:${exemption.package}@${exemption.version} — no judgment recorded\n`
  );
  return 0;
}

function runImport(cmd: Command & { kind: "import" }): number {
  const ledger = loadLedger(cmd.root);
  let text: string;
  try {
    text = fs.readFileSync(cmd.file, "utf8");
  } catch {
    throw new LedgerError(`cannot read \`${cmd.file}\``);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new LedgerError(`\`${cmd.file}\` is not valid JSON (${(err as Error).message})`);
  }
  if (typeof raw !== "object" || raw === null || (raw as Record<string, unknown>)["version"] !== 1) {
    throw new LedgerError(`\`${cmd.file}\` is not a depvouch export (expected \`"version": 1\`)`);
  }
  const vouches = parseVouchArray((raw as Record<string, unknown>)["vouches"] ?? [], cmd.file);
  const name = cmd.as ?? path.basename(cmd.file, ".json");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
    throw new UsageError(`--as \`${name}\` is not a valid source name`);
  }
  const replaced = name in ledger.imports;
  ledger.imports[name] = { imported: cmd.date ?? today(), vouches };
  saveImports(cmd.root, ledger.imports);
  print(
    `depvouch: imported ${countNoun(vouches.length, "vouch", "vouches")} as source \`${name}\`${replaced ? " (replaced the previous import)" : ""}\n`
  );
  return 0;
}

function runExport(root: string): number {
  const ledger = loadLedger(root);
  // Own vouches only: exemptions carry no judgment, and re-exporting
  // imports would launder provenance.
  print(
    JSON.stringify(
      {
        version: 1,
        vouches: sortVouches(ledger.vouches),
      },
      null,
      2
    ) + "\n"
  );
  return 0;
}

function runPrune(cmd: Command & { kind: "prune" }): number {
  const ledger = loadLedger(cmd.root);
  const scan = scanLockfiles(cmd.root, ledger.config.lockfiles);
  const bare = runCheckWithLedger(cmd.root, ledger, { ignoreExemptions: true });
  const coveredByVouches = new Set<string>();
  for (const r of bare.results) {
    if (r.verdict.status === "vouched") {
      coveredByVouches.add(
        `${r.dep.ecosystem}:${canonicalName(r.dep.ecosystem, r.dep.name)}@${canonicalVersion(r.dep.version)}`
      );
    }
  }
  const inLock = new Set(
    scan.deps.map(
      (d) => `${d.ecosystem}:${canonicalName(d.ecosystem, d.name)}@${canonicalVersion(d.version)}`
    )
  );
  const kept: Exemption[] = [];
  const dropped: Array<{ exemption: Exemption; reason: string }> = [];
  for (const e of ledger.exemptions) {
    const key = `${e.ecosystem}:${canonicalName(e.ecosystem, e.package)}@${canonicalVersion(e.version)}`;
    if (!inLock.has(key)) {
      dropped.push({ exemption: e, reason: "no longer in the lockfiles" });
    } else if (coveredByVouches.has(key)) {
      dropped.push({ exemption: e, reason: "now covered by vouches" });
    } else {
      kept.push(e);
    }
  }
  const verb = cmd.dryRun ? "would drop" : "dropped";
  for (const d of dropped) {
    print(
      `${verb} ${d.exemption.ecosystem}:${d.exemption.package}@${d.exemption.version} — ${d.reason}\n`
    );
  }
  if (!cmd.dryRun && dropped.length > 0) {
    saveVouches(cmd.root, ledger.vouches, kept);
  }
  print(
    `depvouch: ${verb} ${countNoun(dropped.length, "exemption")}, ${kept.length} remaining\n`
  );
  return 0;
}

export function main(argv: readonly string[]): number {
  let cmd: Command;
  try {
    cmd = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`depvouch: ${err.message}\n`);
      process.stderr.write(`run \`depvouch --help\` for usage\n`);
      return 2;
    }
    throw err;
  }

  try {
    switch (cmd.kind) {
      case "help":
        print(HELP);
        return 0;
      case "version":
        print(VERSION + "\n");
        return 0;
      case "init": {
        const scan = scanLockfiles(cmd.root);
        const result = initLedger(cmd.root, scan.deps, today());
        print(
          `depvouch: initialized .depvouch/ — ${countNoun(result.exempted, "existing dependency", "existing dependencies")} exempted\n` +
            `the gate starts green; from now on, new dependencies require a vouch\n`
        );
        return 0;
      }
      case "check": {
        const ledger = loadLedger(cmd.root);
        const report = runCheckWithLedger(cmd.root, ledger, {
          ignoreExemptions: cmd.noExemptions,
        });
        print(
          cmd.format === "json"
            ? renderCheckJson(report, ledger)
            : renderCheckText(report, ledger, { quiet: cmd.quiet })
        );
        return report.ok ? 0 : 1;
      }
      case "vouch":
        return runVouch(cmd);
      case "exempt":
        return runExempt(cmd);
      case "list":
        print(renderList(loadLedger(cmd.root)));
        return 0;
      case "suggest": {
        // Exemptions are ignored on purpose: suggest's job is to shrink
        // the un-reviewed surface, and exempted packages are exactly that.
        const ledger = loadLedger(cmd.root);
        const report = runCheckWithLedger(cmd.root, ledger, { ignoreExemptions: true });
        print(renderSuggestText(suggestionsFor(report, ledger)));
        return 0;
      }
      case "import":
        return runImport(cmd);
      case "export":
        return runExport(cmd.root);
      case "prune":
        return runPrune(cmd);
      case "explain": {
        const text = explainTopic(cmd.topic);
        if (text === null) {
          process.stderr.write(
            `depvouch: unknown topic \`${cmd.topic}\` — try: ${EXPLAIN_TOPICS.join(", ")}\n`
          );
          return 2;
        }
        print(text);
        return 0;
      }
    }
  } catch (err) {
    if (err instanceof UsageError || err instanceof LedgerError) {
      process.stderr.write(`depvouch: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

process.exit(main(process.argv.slice(2)));
