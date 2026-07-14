/**
 * The `.depvouch/` ledger on disk: `config.json` (policy),
 * `vouches.json` (this repo's reviews and exemptions) and `imports.json`
 * (vouch sets pulled in from other repos). Loading validates everything
 * eagerly with precise messages; saving is deterministic — entries are
 * sorted, keys are emitted in a fixed order, output ends with a newline —
 * so ledger diffs in code review stay minimal and honest.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  CriteriaDef,
  Exemption,
  ImportSource,
  Ledger,
  LedgerConfig,
  Vouch,
} from "./types.js";
import { isEcosystem } from "./types.js";
import { buildCriteriaTable, assertKnownCriteria } from "./criteria.js";
import { LedgerError } from "./errors.js";

export const LEDGER_DIR = ".depvouch";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readJson(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new LedgerError(`cannot read \`${file}\``);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new LedgerError(`\`${file}\` is not valid JSON (${(err as Error).message})`);
  }
}

export function ledgerDir(root: string): string {
  return path.join(root, LEDGER_DIR);
}

export function ledgerExists(root: string): boolean {
  return fs.existsSync(path.join(ledgerDir(root), "config.json"));
}

/** Load and validate the whole ledger. Throws `LedgerError` with a precise message. */
export function loadLedger(root: string): Ledger {
  const dir = ledgerDir(root);
  if (!ledgerExists(root)) {
    throw new LedgerError(
      `no ledger at \`${path.join(LEDGER_DIR, "config.json")}\` — run \`depvouch init\` first`
    );
  }
  const config = parseConfig(readJson(path.join(dir, "config.json")), "config.json");
  const table = buildCriteriaTable(config.criteria);

  const vouchesFile = path.join(dir, "vouches.json");
  let vouches: Vouch[] = [];
  let exemptions: Exemption[] = [];
  if (fs.existsSync(vouchesFile)) {
    const raw = readJson(vouchesFile);
    if (!isRecord(raw) || raw["version"] !== 1) {
      throw new LedgerError(`vouches.json: expected an object with \`"version": 1\``);
    }
    vouches = parseVouchArray(raw["vouches"] ?? [], "vouches.json");
    exemptions = parseExemptionArray(raw["exemptions"] ?? [], "vouches.json");
  }
  for (const [i, v] of vouches.entries()) {
    assertKnownCriteria(v.criteria, table, `vouches.json: vouches[${i}]`);
  }
  assertKnownCriteria(config.defaultCriteria, table, "config.json: default-criteria");
  assertKnownCriteria(config.devCriteria, table, "config.json: dev-criteria");
  for (const [key, entry] of Object.entries(config.policy)) {
    assertKnownCriteria(entry.criteria, table, `config.json: policy["${key}"]`);
  }

  const importsFile = path.join(dir, "imports.json");
  let imports: Record<string, ImportSource> = {};
  if (fs.existsSync(importsFile)) {
    imports = parseImports(readJson(importsFile));
  }

  return { config, vouches, exemptions, imports };
}

function parseConfig(raw: unknown, file: string): LedgerConfig {
  if (!isRecord(raw)) throw new LedgerError(`${file}: expected a JSON object`);
  if (raw["version"] !== 1) {
    throw new LedgerError(`${file}: unsupported ledger version \`${String(raw["version"])}\` (expected 1)`);
  }
  const stringArray = (key: string, fallback: string[]): string[] => {
    const v = raw[key];
    if (v === undefined) return fallback;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new LedgerError(`${file}: \`${key}\` must be an array of strings`);
    }
    return v as string[];
  };
  const criteria: Record<string, CriteriaDef> = {};
  const rawCriteria = raw["criteria"] ?? {};
  if (!isRecord(rawCriteria)) throw new LedgerError(`${file}: \`criteria\` must be an object`);
  for (const [name, def] of Object.entries(rawCriteria)) {
    if (!isRecord(def) || typeof def["description"] !== "string") {
      throw new LedgerError(`${file}: criteria \`${name}\` needs a string \`description\``);
    }
    const implies = def["implies"] ?? [];
    if (!Array.isArray(implies) || implies.some((x) => typeof x !== "string")) {
      throw new LedgerError(`${file}: criteria \`${name}\`: \`implies\` must be an array of strings`);
    }
    criteria[name] = { description: def["description"], implies: implies as string[] };
  }
  const policy: Record<string, { criteria: string[] }> = {};
  const rawPolicy = raw["policy"] ?? {};
  if (!isRecord(rawPolicy)) throw new LedgerError(`${file}: \`policy\` must be an object`);
  for (const [key, entry] of Object.entries(rawPolicy)) {
    if (!/^(npm|pypi):.+$/.test(key)) {
      throw new LedgerError(`${file}: policy key \`${key}\` must look like \`npm:<name>\` or \`pypi:<name>\``);
    }
    if (!isRecord(entry) || !Array.isArray(entry["criteria"]) || entry["criteria"].some((x) => typeof x !== "string")) {
      throw new LedgerError(`${file}: policy \`${key}\` needs a \`criteria\` array of strings`);
    }
    policy[key] = { criteria: entry["criteria"] as string[] };
  }
  return {
    defaultCriteria: stringArray("default-criteria", ["safe-to-deploy"]),
    devCriteria: stringArray("dev-criteria", ["safe-to-run"]),
    criteria,
    policy,
    lockfiles: stringArray("lockfiles", []),
  };
}

export function parseVouchArray(raw: unknown, file: string): Vouch[] {
  if (!Array.isArray(raw)) throw new LedgerError(`${file}: \`vouches\` must be an array`);
  return raw.map((entry, i) => parseVouch(entry, `${file}: vouches[${i}]`));
}

function parseVouch(raw: unknown, where: string): Vouch {
  if (!isRecord(raw)) throw new LedgerError(`${where}: expected an object`);
  const str = (key: string, required: boolean): string | undefined => {
    const v = raw[key];
    if (v === undefined) {
      if (required) throw new LedgerError(`${where}: missing \`${key}\``);
      return undefined;
    }
    if (typeof v !== "string" || v === "") {
      throw new LedgerError(`${where}: \`${key}\` must be a non-empty string`);
    }
    return v;
  };
  const ecosystem = str("ecosystem", true) as string;
  if (!isEcosystem(ecosystem)) {
    throw new LedgerError(`${where}: unknown ecosystem \`${ecosystem}\` (npm or pypi)`);
  }
  const criteria = raw["criteria"];
  if (!Array.isArray(criteria) || criteria.length === 0 || criteria.some((x) => typeof x !== "string")) {
    throw new LedgerError(`${where}: \`criteria\` must be a non-empty array of strings`);
  }
  const date = str("date", true) as string;
  if (!DATE_RE.test(date)) throw new LedgerError(`${where}: \`date\` must be YYYY-MM-DD`);
  const version = str("version", true) as string;
  const from = str("from", false);
  if (from !== undefined && from === version) {
    throw new LedgerError(`${where}: \`from\` equals \`version\` — a delta must change versions`);
  }
  const vouch: Vouch = {
    ecosystem,
    package: str("package", true) as string,
    version,
    criteria: criteria as string[],
    by: str("by", true) as string,
    date,
  };
  if (from !== undefined) vouch.from = from;
  const note = str("note", false);
  if (note !== undefined) vouch.note = note;
  return vouch;
}

function parseExemptionArray(raw: unknown, file: string): Exemption[] {
  if (!Array.isArray(raw)) throw new LedgerError(`${file}: \`exemptions\` must be an array`);
  return raw.map((entry, i) => {
    const where = `${file}: exemptions[${i}]`;
    if (!isRecord(entry)) throw new LedgerError(`${where}: expected an object`);
    const ecosystem = entry["ecosystem"];
    if (!isEcosystem(ecosystem)) throw new LedgerError(`${where}: unknown ecosystem`);
    const pkg = entry["package"];
    const version = entry["version"];
    if (typeof pkg !== "string" || pkg === "") throw new LedgerError(`${where}: missing \`package\``);
    if (typeof version !== "string" || version === "") throw new LedgerError(`${where}: missing \`version\``);
    const out: Exemption = { ecosystem, package: pkg, version };
    if (typeof entry["note"] === "string" && entry["note"] !== "") out.note = entry["note"];
    return out;
  });
}

function parseImports(raw: unknown): Record<string, ImportSource> {
  if (!isRecord(raw) || raw["version"] !== 1) {
    throw new LedgerError(`imports.json: expected an object with \`"version": 1\``);
  }
  const sources = raw["sources"] ?? {};
  if (!isRecord(sources)) throw new LedgerError(`imports.json: \`sources\` must be an object`);
  const out: Record<string, ImportSource> = {};
  for (const [name, entry] of Object.entries(sources)) {
    if (!isRecord(entry)) throw new LedgerError(`imports.json: source \`${name}\` must be an object`);
    const imported = entry["imported"];
    if (typeof imported !== "string" || !DATE_RE.test(imported)) {
      throw new LedgerError(`imports.json: source \`${name}\` needs an \`imported\` date (YYYY-MM-DD)`);
    }
    // Only structural validity is enforced here: imported vouches may use
    // criteria this repo has not defined, and such vouches simply never
    // satisfy anything during resolution.
    const vouches = parseVouchArray(entry["vouches"] ?? [], `imports.json (source ${name})`);
    out[name] = { imported, vouches };
  }
  return out;
}

// --- serialization -------------------------------------------------------

function vouchKey(v: Vouch): string {
  return [v.ecosystem, v.package, v.version, v.from ?? "", v.by].join("\u0000");
}

export function sortVouches(vouches: Vouch[]): Vouch[] {
  return [...vouches].sort((a, b) => vouchKey(a).localeCompare(vouchKey(b)));
}

export function sortExemptions(exemptions: Exemption[]): Exemption[] {
  return [...exemptions].sort((a, b) =>
    `${a.ecosystem}:${a.package}@${a.version}`.localeCompare(`${b.ecosystem}:${b.package}@${b.version}`)
  );
}

function vouchToDisk(v: Vouch): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ecosystem: v.ecosystem,
    package: v.package,
    version: v.version,
  };
  if (v.from !== undefined) out["from"] = v.from;
  out["criteria"] = v.criteria;
  out["by"] = v.by;
  out["date"] = v.date;
  if (v.note !== undefined) out["note"] = v.note;
  return out;
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/** Persist vouches + exemptions (sorted, stable key order). */
export function saveVouches(root: string, vouches: Vouch[], exemptions: Exemption[]): void {
  writeJson(path.join(ledgerDir(root), "vouches.json"), {
    version: 1,
    vouches: sortVouches(vouches).map(vouchToDisk),
    exemptions: sortExemptions(exemptions).map((e) => {
      const out: Record<string, unknown> = {
        ecosystem: e.ecosystem,
        package: e.package,
        version: e.version,
      };
      if (e.note !== undefined) out["note"] = e.note;
      return out;
    }),
  });
}

/** Persist the imported sources. */
export function saveImports(root: string, imports: Record<string, ImportSource>): void {
  const sources: Record<string, unknown> = {};
  for (const name of Object.keys(imports).sort()) {
    const src = imports[name] as ImportSource;
    sources[name] = { imported: src.imported, vouches: sortVouches(src.vouches).map(vouchToDisk) };
  }
  writeJson(path.join(ledgerDir(root), "imports.json"), { version: 1, sources });
}

export interface InitResult {
  exempted: number;
}

/** Create a fresh ledger, exempting the current dependency set so the gate starts green. */
export function initLedger(
  root: string,
  currentDeps: readonly { ecosystem: "npm" | "pypi"; name: string; version: string }[],
  date: string
): InitResult {
  if (ledgerExists(root)) {
    throw new LedgerError(`\`${LEDGER_DIR}/\` already exists — refusing to overwrite the ledger`);
  }
  fs.mkdirSync(ledgerDir(root), { recursive: true });
  writeJson(path.join(ledgerDir(root), "config.json"), {
    version: 1,
    "default-criteria": ["safe-to-deploy"],
    "dev-criteria": ["safe-to-run"],
    criteria: {},
    policy: {},
  });
  const exemptions: Exemption[] = currentDeps.map((dep) => ({
    ecosystem: dep.ecosystem,
    package: dep.name,
    version: dep.version,
    note: `seeded by depvouch init on ${date}`,
  }));
  saveVouches(root, [], exemptions);
  return { exempted: exemptions.length };
}
