/**
 * package-lock.json parser. Handles lockfile versions 2 and 3 (the
 * `packages` map) plus the legacy v1 `dependencies` tree. In-repo
 * workspace packages and `link:` entries are skipped — depvouch reviews
 * third-party code, not your own. Non-registry pins (git URLs, tarball
 * URLs, `file:` paths) cannot be identified by an exact version, so they
 * are surfaced as problems for the gate instead of silently passing.
 */

import type { Dep } from "./types.js";

export interface ParsedLockfile {
  deps: Dep[];
  problems: string[];
}

interface RawEntry {
  name?: unknown;
  version?: unknown;
  dev?: unknown;
  link?: unknown;
  resolved?: unknown;
  dependencies?: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const NON_REGISTRY_RE = /^(git\+|git:|github:|https?:|file:|link:|workspace:)/;

/** Parse one package-lock.json. `source` is the repo-relative path used in reports. */
export function parseNpmLock(text: string, source: string): ParsedLockfile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {
      deps: [],
      problems: [`${source}: not valid JSON (${(err as Error).message})`],
    };
  }
  if (!isRecord(raw)) {
    return { deps: [], problems: [`${source}: expected a JSON object at the top level`] };
  }

  const found = new Map<string, Dep>();
  const problems: string[] = [];
  const add = (name: string, version: string, dev: boolean): void => {
    if (NON_REGISTRY_RE.test(version)) {
      problems.push(
        `${source}: \`${name}\` resolves to a non-registry source (\`${version}\`) — pin a registry version so it can be vouched`
      );
      return;
    }
    const key = `${name}@${version}`;
    const existing = found.get(key);
    if (existing !== undefined) {
      // A package is only dev if *every* occurrence is dev.
      existing.dev = existing.dev && dev;
      return;
    }
    found.set(key, { ecosystem: "npm", name, version, dev, sources: [source] });
  };

  const packages = raw["packages"];
  if (isRecord(packages)) {
    for (const [key, value] of Object.entries(packages)) {
      if (!isRecord(value)) continue;
      const entry = value as RawEntry;
      if (key === "") continue; // the root project itself
      if (entry.link === true) continue; // symlink into the workspace
      const idx = key.lastIndexOf("node_modules/");
      if (idx === -1) continue; // workspace package ("packages/foo") — first-party code
      const name =
        typeof entry.name === "string" && entry.name !== ""
          ? entry.name
          : key.slice(idx + "node_modules/".length);
      if (typeof entry.version !== "string" || entry.version === "") {
        problems.push(`${source}: \`${name}\` has no version recorded — regenerate the lockfile`);
        continue;
      }
      add(name, entry.version, entry.dev === true);
    }
    return { deps: [...found.values()], problems };
  }

  const legacy = raw["dependencies"];
  if (isRecord(legacy)) {
    walkLegacy(legacy, add, problems, source);
    return { deps: [...found.values()], problems };
  }

  problems.push(`${source}: neither \`packages\` nor \`dependencies\` present — is this a package-lock.json?`);
  return { deps: [], problems };
}

function walkLegacy(
  tree: Record<string, unknown>,
  add: (name: string, version: string, dev: boolean) => void,
  problems: string[],
  source: string
): void {
  for (const [name, value] of Object.entries(tree)) {
    if (!isRecord(value)) continue;
    const entry = value as RawEntry;
    let version = typeof entry.version === "string" ? entry.version : "";
    if (version === "") {
      problems.push(`${source}: \`${name}\` has no version recorded — regenerate the lockfile`);
    } else {
      // npm records aliases as "npm:real-name@1.2.3" — vouch the real package.
      const alias = /^npm:(.+)@([^@]+)$/.exec(version);
      let realName = name;
      if (alias !== null) {
        realName = alias[1] as string;
        version = alias[2] as string;
      }
      add(realName, version, entry.dev === true);
    }
    if (isRecord(entry.dependencies)) {
      walkLegacy(entry.dependencies, add, problems, source);
    }
  }
}
