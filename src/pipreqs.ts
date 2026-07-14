/**
 * requirements.txt parser. Accepts the format pip actually reads:
 * comments, backslash continuations, `--hash=` attestations, environment
 * markers, extras, and nested `-r`/`--requirement` includes (resolved
 * from disk with a cycle guard). depvouch is a review ledger, so only
 * exact pins (`==`, `===`) are acceptable — ranges, unversioned names,
 * editables and URL requirements are reported as problems: a version
 * nobody can name is a version nobody can vouch for.
 */

import type { Dep } from "./types.js";
import { canonicalName } from "./semverish.js";
import type { ParsedLockfile } from "./npmlock.js";

export interface PipParseOptions {
  /** Resolve a `-r other.txt` include: return its text, or null if unreadable. */
  readInclude?: (relPath: string, fromSource: string) => string | null;
  /** Mark every requirement as a dev dependency (for requirements-dev.txt). */
  dev?: boolean;
}

/** Options pip accepts on a requirement line or standalone that depvouch skips silently. */
const IGNORED_OPTIONS = new Set([
  "-i",
  "--index-url",
  "--extra-index-url",
  "--no-index",
  "-f",
  "--find-links",
  "--trusted-host",
  "--pre",
  "--no-binary",
  "--only-binary",
  "--prefer-binary",
  "--require-hashes",
  "--use-feature",
]);

const NAME_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]|[A-Za-z0-9])/;

export function parseRequirements(
  text: string,
  source: string,
  options: PipParseOptions = {},
  seen: Set<string> = new Set([source])
): ParsedLockfile {
  const deps: Dep[] = [];
  const problems: string[] = [];
  const found = new Map<string, Dep>();

  for (const line of logicalLines(text)) {
    const stripped = stripComment(line).trim();
    if (stripped === "") continue;

    if (stripped.startsWith("-")) {
      handleOption(stripped, source, options, seen, found, problems);
      continue;
    }

    if (/^(git\+|hg\+|svn\+|bzr\+|https?:\/\/|\.{1,2}\/|\/)/.test(stripped)) {
      problems.push(
        `${source}: \`${firstWord(stripped)}\` is a URL or path requirement — pin a registry version so it can be vouched`
      );
      continue;
    }

    const req = parseRequirementLine(stripped, source);
    if (req.problem !== null) {
      problems.push(req.problem);
      continue;
    }
    if (req.dep !== null) {
      const dep = { ...req.dep, dev: options.dev === true };
      const key = `${dep.name}@${dep.version}`;
      if (!found.has(key)) found.set(key, dep);
    }
  }

  deps.push(...found.values());
  return { deps, problems };
}

/** Join backslash-continued physical lines into logical lines. */
function logicalLines(text: string): string[] {
  const out: string[] = [];
  let buffer = "";
  for (const physical of text.split(/\r?\n/)) {
    if (physical.endsWith("\\")) {
      buffer += physical.slice(0, -1) + " ";
      continue;
    }
    buffer += physical;
    out.push(buffer);
    buffer = "";
  }
  if (buffer !== "") out.push(buffer);
  return out;
}

/** Remove a `#` comment (pip requires whitespace before an inline `#`). */
function stripComment(line: string): string {
  if (line.trimStart().startsWith("#")) return "";
  const idx = line.search(/\s#/);
  return idx >= 0 ? line.slice(0, idx) : line;
}

function firstWord(s: string): string {
  return s.split(/\s+/)[0] as string;
}

function handleOption(
  stripped: string,
  source: string,
  options: PipParseOptions,
  seen: Set<string>,
  found: Map<string, Dep>,
  problems: string[]
): void {
  const [flag, ...rest] = stripped.split(/\s+/) as [string, ...string[]];
  const eq = flag.indexOf("=");
  const flagName = eq >= 0 ? flag.slice(0, eq) : flag;

  if (flagName === "-r" || flagName === "--requirement") {
    const target = eq >= 0 ? flag.slice(eq + 1) : rest[0];
    if (target === undefined || target === "") {
      problems.push(`${source}: \`${flagName}\` needs a file argument`);
      return;
    }
    if (seen.has(target)) {
      problems.push(`${source}: include cycle at \`${target}\``);
      return;
    }
    const read = options.readInclude;
    if (read === undefined) {
      problems.push(`${source}: nested include \`${target}\` was not followed`);
      return;
    }
    const included = read(target, source);
    if (included === null) {
      problems.push(`${source}: included file \`${target}\` cannot be read`);
      return;
    }
    seen.add(target);
    const sub = parseRequirements(included, target, options, seen);
    for (const dep of sub.deps) {
      const key = `${dep.name}@${dep.version}`;
      if (!found.has(key)) found.set(key, dep);
    }
    problems.push(...sub.problems);
    return;
  }

  if (flagName === "-e" || flagName === "--editable") {
    problems.push(
      `${source}: editable requirement \`${rest[0] ?? ""}\` — pin a registry version so it can be vouched`
    );
    return;
  }

  if (flagName === "-c" || flagName === "--constraint") {
    return; // constraints restrict resolution but do not add dependencies
  }

  if (!IGNORED_OPTIONS.has(flagName)) {
    problems.push(`${source}: unrecognized option \`${flagName}\``);
  }
}

function parseRequirementLine(
  stripped: string,
  source: string
): { dep: Omit<Dep, "dev"> | null; problem: string | null } {
  // Drop environment markers and per-requirement hashes: they scope *when*
  // a requirement applies, not *what* it is.
  let body = stripped.split(";")[0] as string;
  body = body.replace(/--hash=\S+/g, "").trim();

  const nameMatch = NAME_RE.exec(body);
  if (nameMatch === null) {
    return { dep: null, problem: `${source}: cannot parse requirement \`${firstWord(stripped)}\`` };
  }
  const rawName = nameMatch[0];
  let rest = body.slice(rawName.length).trim();
  rest = rest.replace(/^\[[^\]]*\]/, "").trim(); // extras never change the reviewed code's identity

  if (rest === "") {
    return {
      dep: null,
      problem: `${source}: \`${rawName}\` has no version pin — depvouch needs an exact \`==\` pin`,
    };
  }

  const pin = /^===?\s*(\S+)$/.exec(rest);
  if (pin === null || (pin[1] as string).includes("*")) {
    return {
      dep: null,
      problem: `${source}: \`${rawName}${rest}\` is not pinned to an exact version — use \`==\``,
    };
  }

  return {
    dep: {
      ecosystem: "pypi",
      name: canonicalName("pypi", rawName),
      version: pin[1] as string,
      sources: [source],
    },
    problem: null,
  };
}
