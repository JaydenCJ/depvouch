/**
 * Argument parsing for the depvouch CLI. Hand-rolled and dependency-free:
 * ten subcommands, long flags with values, and typed `UsageError`s so the
 * CLI can exit 2 on usage problems without ever throwing raw stack traces
 * at the user. `check` is the default subcommand — `depvouch` alone in CI
 * does the right thing.
 */

import { UsageError } from "./errors.js";
import { isEcosystem, type Ecosystem } from "./types.js";

export interface PackageSpec {
  name: string;
  version: string;
}

/** Parse `name@version`, including scoped npm names (`@scope/pkg@1.2.3`). */
export function parseSpec(raw: string): PackageSpec {
  const at = raw.lastIndexOf("@");
  if (at <= 0) {
    throw new UsageError(`expected \`<package>@<version>\`, got \`${raw}\``);
  }
  const name = raw.slice(0, at);
  const version = raw.slice(at + 1);
  if (name === "" || version === "") {
    throw new UsageError(`expected \`<package>@<version>\`, got \`${raw}\``);
  }
  return { name, version };
}

export type Command =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "init"; root: string }
  | {
      kind: "check";
      root: string;
      format: "text" | "json";
      quiet: boolean;
      noExemptions: boolean;
    }
  | {
      kind: "vouch";
      root: string;
      spec: PackageSpec;
      eco: Ecosystem | null;
      criteria: string[] | null;
      by: string | null;
      from: string | null;
      note: string | null;
      date: string | null;
    }
  | {
      kind: "exempt";
      root: string;
      spec: PackageSpec;
      eco: Ecosystem | null;
      note: string | null;
    }
  | { kind: "list"; root: string }
  | { kind: "suggest"; root: string }
  | { kind: "import"; root: string; file: string; as: string | null; date: string | null }
  | { kind: "export"; root: string }
  | { kind: "prune"; root: string; dryRun: boolean }
  | { kind: "explain"; topic: string };

const SUBCOMMANDS = [
  "init",
  "check",
  "vouch",
  "exempt",
  "list",
  "suggest",
  "import",
  "export",
  "prune",
  "explain",
] as const;

export function parseArgs(argv: readonly string[]): Command {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) return { kind: "help" };
  if (args.includes("--version") || args.includes("-V")) return { kind: "version" };

  let sub = "check";
  if (args.length > 0 && !String(args[0]).startsWith("-")) {
    const head = String(args[0]);
    if ((SUBCOMMANDS as readonly string[]).includes(head)) {
      sub = head;
      args.shift();
    } else if (head.includes("@")) {
      throw new UsageError(`\`${head}\` looks like a package spec — did you mean \`depvouch vouch ${head}\`?`);
    }
    // Anything else falls through as the positional dir of the default `check`.
  }

  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  const VALUE_FLAGS = new Set([
    "--dir",
    "--eco",
    "--criteria",
    "--by",
    "--from",
    "--note",
    "--date",
    "--as",
    "--format",
  ]);
  const BOOL_FLAGS = new Set(["--quiet", "-q", "--no-exemptions", "--dry-run"]);
  while (args.length > 0) {
    const arg = String(args.shift());
    if (VALUE_FLAGS.has(arg)) {
      const v = args.shift();
      if (v === undefined) throw new UsageError(`${arg} needs a value`);
      flags.set(arg, String(v));
    } else if (BOOL_FLAGS.has(arg)) {
      flags.set(arg === "-q" ? "--quiet" : arg, true);
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown flag \`${arg}\``);
    } else {
      positionals.push(arg);
    }
  }

  const str = (flag: string): string | null => {
    const v = flags.get(flag);
    return typeof v === "string" ? v : null;
  };
  const rootFromPositional = (max: number): string => {
    if (positionals.length > max) {
      throw new UsageError(`unexpected argument \`${positionals[max]}\``);
    }
    return positionals[max - 1] ?? str("--dir") ?? ".";
  };
  const eco = ((): Ecosystem | null => {
    const v = str("--eco");
    if (v === null) return null;
    if (!isEcosystem(v)) throw new UsageError(`--eco must be npm or pypi, got \`${v}\``);
    return v;
  })();

  switch (sub) {
    case "init":
      return { kind: "init", root: rootFromPositional(1) };
    case "check": {
      const format = str("--format") ?? "text";
      if (format !== "text" && format !== "json") {
        throw new UsageError(`--format must be text or json, got \`${format}\``);
      }
      return {
        kind: "check",
        root: rootFromPositional(1),
        format,
        quiet: flags.get("--quiet") === true,
        noExemptions: flags.get("--no-exemptions") === true,
      };
    }
    case "list":
      return { kind: "list", root: rootFromPositional(1) };
    case "suggest":
      return { kind: "suggest", root: rootFromPositional(1) };
    case "export":
      return { kind: "export", root: rootFromPositional(1) };
    case "prune":
      return { kind: "prune", root: rootFromPositional(1), dryRun: flags.get("--dry-run") === true };
    case "vouch": {
      const raw = positionals.shift();
      if (raw === undefined) throw new UsageError("vouch needs a `<package>@<version>` argument");
      if (positionals.length > 0) throw new UsageError(`unexpected argument \`${positionals[0]}\``);
      const criteria = str("--criteria");
      return {
        kind: "vouch",
        root: str("--dir") ?? ".",
        spec: parseSpec(raw),
        eco,
        criteria: criteria === null ? null : criteria.split(",").map((c) => c.trim()).filter((c) => c !== ""),
        by: str("--by"),
        from: str("--from"),
        note: str("--note"),
        date: str("--date"),
      };
    }
    case "exempt": {
      const raw = positionals.shift();
      if (raw === undefined) throw new UsageError("exempt needs a `<package>@<version>` argument");
      if (positionals.length > 0) throw new UsageError(`unexpected argument \`${positionals[0]}\``);
      return { kind: "exempt", root: str("--dir") ?? ".", spec: parseSpec(raw), eco, note: str("--note") };
    }
    case "import": {
      const file = positionals.shift();
      if (file === undefined) throw new UsageError("import needs a file argument (an export produced by `depvouch export`)");
      if (positionals.length > 0) throw new UsageError(`unexpected argument \`${positionals[0]}\``);
      return { kind: "import", root: str("--dir") ?? ".", file, as: str("--as"), date: str("--date") };
    }
    case "explain": {
      const topic = positionals.shift();
      if (topic === undefined) {
        throw new UsageError("explain needs a topic: criteria, delta, exemptions, imports, ledger, or exit-codes");
      }
      if (positionals.length > 0) throw new UsageError(`unexpected argument \`${positionals[0]}\``);
      return { kind: "explain", topic };
    }
    default:
      throw new UsageError(`unknown subcommand \`${sub}\``);
  }
}

export const HELP = `depvouch — an in-repo ledger of human dependency reviews, enforced in CI

Usage:
  depvouch init [dir]                     create .depvouch/ and exempt today's dependencies
  depvouch [check] [dir] [flags]          gate: every locked dependency must be vouched
  depvouch vouch <pkg>@<version> [flags]  record a human review in the ledger
  depvouch exempt <pkg>@<version>         record a temporary, judgment-free pass
  depvouch suggest [dir]                  cheapest reviews for full coverage (exempted deps included)
  depvouch list [dir]                     print the ledger inventory
  depvouch import <file> --as <name>      import vouches shared by another repo
  depvouch export [dir]                   print this repo's vouches as a shareable file
  depvouch prune [dir] [--dry-run]        drop exemptions that are no longer needed
  depvouch explain <topic>                offline docs: criteria, delta, exemptions,
                                          imports, ledger, exit-codes

Global flags:
  --dir <dir>         repo root to operate on (default: ".", same as the [dir] positional)
  -h, --help          print this help
  -V, --version       print the version

Flags (check):
  --format <fmt>      text | json   (default: text)
  --no-exemptions     treat exemptions as absent — see what real coverage looks like
  -q, --quiet         header and verdict lines only

Flags (vouch / exempt):
  --eco <ecosystem>   npm | pypi (inferred from the lockfiles when unambiguous)
  --criteria <list>   comma-separated criteria (default: the config's default-criteria)
  --by <reviewer>     who performed the review (required for vouch)
  --from <version>    record a delta review of the <from> -> <version> diff
  --note <text>       free-form note stored with the entry
  --date <date>       override the recorded date (YYYY-MM-DD; default: today)

Exit codes:
  0  check passed — every dependency is vouched or exempted
  1  check failed — unvouched dependencies or lockfile problems
  2  usage error, or a broken ledger/lockfile input
`;
