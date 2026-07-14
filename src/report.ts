/**
 * Rendering: turn a `CheckReport` (or the ledger inventory, or a
 * suggestion list) into deterministic text or JSON. Text is written for
 * humans reading a failed CI job — every unvouched dependency comes with
 * the exact command that records the missing review. JSON is a stable
 * shape for machines; its top-level `ok` mirrors the exit code.
 */

import type { CheckReport, DepResult, Ledger, SourcedVouch, Vouch } from "./types.js";
import type { Suggestion } from "./suggest.js";
import { allVouches } from "./resolve.js";
import { buildCriteriaTable } from "./criteria.js";
import { suggestFor } from "./suggest.js";

/** `1 lockfile`, `2 lockfiles` — a count with a correctly pluralized noun. */
export function countNoun(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function describeVouch(v: SourcedVouch): string {
  const kind = v.from !== undefined ? `delta ${v.from} -> ${v.version}` : `full ${v.version}`;
  const origin = v.origin !== null ? `, imported from ${v.origin}` : "";
  return `${kind} (${v.criteria.join("+")}, by ${v.by}${origin})`;
}

/** Suggestions for every unvouched dependency in a report. */
export function suggestionsFor(report: CheckReport, ledger: Ledger): Suggestion[] {
  const table = buildCriteriaTable(ledger.config.criteria);
  const vouches = allVouches(ledger);
  const out: Suggestion[] = [];
  for (const r of report.results) {
    if (r.verdict.status !== "unvouched") continue;
    out.push(suggestFor(r.dep, r.verdict.missing, vouches, table));
  }
  return out;
}

export function renderCheckText(
  report: CheckReport,
  ledger: Ledger,
  options: { quiet?: boolean } = {}
): string {
  const lines: string[] = [];
  const s = report.summary;
  const fileList = report.files
    .map((f) => `${f.path} (${f.count} ${f.ecosystem})`)
    .join(", ");
  lines.push(
    `depvouch: ${countNoun(report.files.length, "lockfile")} — ${fileList === "" ? "none found" : fileList}`
  );

  if (options.quiet !== true) {
    const suggestions = suggestionsFor(report, ledger);
    const byKey = new Map(suggestions.map((sug) => [depKey(sug.dep), sug]));

    const unvouched = report.results.filter((r) => r.verdict.status === "unvouched");
    if (unvouched.length > 0) {
      lines.push("", `UNVOUCHED (${unvouched.length})`);
      for (const r of unvouched) {
        if (r.verdict.status !== "unvouched") continue;
        lines.push(
          `  ${r.dep.ecosystem.padEnd(4)} ${r.dep.name}@${r.dep.version}${r.dep.dev ? " (dev)" : ""} — missing ${r.verdict.missing.join(", ")}`
        );
        const sug = byKey.get(depKey(r.dep));
        if (sug !== undefined) {
          lines.push(
            sug.base !== null
              ? `       nearest certified version: ${sug.base} — review the ${sug.base} -> ${r.dep.version} diff`
              : "       no certified prior version — a full review is needed"
          );
          lines.push(`       fix: ${sug.command}`);
        }
      }
    }

    if (report.problems.length > 0) {
      lines.push("", `PROBLEMS (${report.problems.length})`);
      for (const p of report.problems) lines.push(`  ${p}`);
    }
  }

  lines.push("");
  const tally = `${s.vouched} vouched, ${s.exempted} exempted, ${s.unvouched} unvouched`;
  if (report.ok) {
    lines.push(`depvouch: OK — every dependency is accounted for (${tally})`);
  } else {
    const causes: string[] = [];
    if (s.unvouched > 0) causes.push(`${s.unvouched} unvouched`);
    if (s.problems > 0) causes.push(countNoun(s.problems, "problem"));
    lines.push(`depvouch: FAIL — ${causes.join(", ")} (${tally})`);
  }
  return lines.join("\n") + "\n";
}

function depKey(dep: { ecosystem: string; name: string; version: string }): string {
  return `${dep.ecosystem}:${dep.name}@${dep.version}`;
}

export function renderCheckJson(report: CheckReport, ledger: Ledger): string {
  const suggestions = suggestionsFor(report, ledger);
  const byKey = new Map(suggestions.map((sug) => [depKey(sug.dep), sug]));
  const deps = report.results.map((r: DepResult) => {
    const base: Record<string, unknown> = {
      ecosystem: r.dep.ecosystem,
      name: r.dep.name,
      version: r.dep.version,
      dev: r.dep.dev,
      sources: r.dep.sources,
      required: r.required,
      status: r.verdict.status,
    };
    if (r.verdict.status === "vouched") {
      base["via"] = r.verdict.via.map((v) => ({
        kind: v.from !== undefined ? "delta" : "full",
        version: v.version,
        ...(v.from !== undefined ? { from: v.from } : {}),
        criteria: v.criteria,
        by: v.by,
        origin: v.origin,
      }));
    } else if (r.verdict.status === "exempted") {
      base["exemption"] = { note: r.verdict.exemption.note ?? null };
    } else {
      base["missing"] = r.verdict.missing;
      const sug = byKey.get(depKey(r.dep));
      base["suggestion"] = sug === undefined ? null : { base: sug.base, command: sug.command };
    }
    return base;
  });
  return (
    JSON.stringify(
      {
        ok: report.ok,
        summary: report.summary,
        files: report.files,
        deps,
        problems: report.problems,
      },
      null,
      2
    ) + "\n"
  );
}

export function renderSuggestText(suggestions: readonly Suggestion[]): string {
  if (suggestions.length === 0) {
    return "depvouch: nothing to suggest — every dependency is fully vouched\n";
  }
  const lines: string[] = [`depvouch: ${countNoun(suggestions.length, "review")} needed for full coverage`, ""];
  for (const sug of suggestions) {
    const scope =
      sug.base !== null ? `delta review ${sug.base} -> ${sug.dep.version}` : "full review";
    lines.push(`  ${sug.dep.ecosystem.padEnd(4)} ${sug.dep.name}@${sug.dep.version} — ${scope} for ${sug.criteria.join(", ")}`);
    lines.push(`       ${sug.command}`);
  }
  return lines.join("\n") + "\n";
}

export function renderList(ledger: Ledger): string {
  const lines: string[] = [];
  const byPackage = new Map<string, Vouch[]>();
  for (const v of ledger.vouches) {
    const key = `${v.ecosystem}:${v.package}`;
    const list = byPackage.get(key) ?? [];
    list.push(v);
    byPackage.set(key, list);
  }
  lines.push(`vouches (${ledger.vouches.length})`);
  for (const key of [...byPackage.keys()].sort()) {
    lines.push(`  ${key}`);
    for (const v of byPackage.get(key) as Vouch[]) {
      lines.push(`    ${describeVouch({ ...v, origin: null })} on ${v.date}${v.note !== undefined ? ` — ${v.note}` : ""}`);
    }
  }
  lines.push("", `exemptions (${ledger.exemptions.length})`);
  for (const e of ledger.exemptions) {
    lines.push(`  ${e.ecosystem}:${e.package}@${e.version}${e.note !== undefined ? ` — ${e.note}` : ""}`);
  }
  const importNames = Object.keys(ledger.imports).sort();
  lines.push("", `imported sources (${importNames.length})`);
  for (const name of importNames) {
    const src = ledger.imports[name] as { imported: string; vouches: Vouch[] };
    lines.push(`  ${name}: ${countNoun(src.vouches.length, "vouch", "vouches")}, imported ${src.imported}`);
  }
  return lines.join("\n") + "\n";
}
