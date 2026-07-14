/**
 * Lockfile discovery and aggregation. By default depvouch looks for the
 * well-known names at the repo root (`package-lock.json`,
 * `requirements.txt` and its dev twins); a project with a different
 * layout lists its lockfiles explicitly in `.depvouch/config.json`. All
 * files are merged into one deduplicated dependency set — a package
 * pinned by two lockfiles is still one review.
 */

import fs from "node:fs";
import path from "node:path";
import type { Dep, LockfileInfo, Ecosystem } from "./types.js";
import { parseNpmLock } from "./npmlock.js";
import { parseRequirements } from "./pipreqs.js";
import { LedgerError } from "./errors.js";

export interface LockfileScan {
  deps: Dep[];
  files: LockfileInfo[];
  problems: string[];
}

interface Candidate {
  rel: string;
  ecosystem: Ecosystem;
  dev: boolean;
}

const DEFAULT_CANDIDATES: Candidate[] = [
  { rel: "package-lock.json", ecosystem: "npm", dev: false },
  { rel: "requirements.txt", ecosystem: "pypi", dev: false },
  { rel: "requirements-dev.txt", ecosystem: "pypi", dev: true },
  { rel: "dev-requirements.txt", ecosystem: "pypi", dev: true },
];

/** Classify an explicitly configured lockfile path by its basename. */
export function classifyLockfile(rel: string): Candidate {
  const base = path.basename(rel);
  if (base === "package-lock.json") return { rel, ecosystem: "npm", dev: false };
  if (/^(requirements|constraints).*\.(txt|in)$/.test(base) || /requirements\.txt$/.test(base)) {
    const dev = /dev/.test(base);
    return { rel, ecosystem: "pypi", dev };
  }
  throw new LedgerError(
    `config lists unsupported lockfile \`${rel}\` — depvouch 0.1 reads package-lock.json and requirements*.txt`
  );
}

/** Read and merge every lockfile for a repo root. */
export function scanLockfiles(root: string, configured: string[] = []): LockfileScan {
  const candidates: Candidate[] = [];
  if (configured.length > 0) {
    for (const rel of configured) {
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) {
        throw new LedgerError(`config lists lockfile \`${rel}\` but it does not exist`);
      }
      candidates.push(classifyLockfile(rel));
    }
  } else {
    for (const candidate of DEFAULT_CANDIDATES) {
      if (fs.existsSync(path.join(root, candidate.rel))) candidates.push(candidate);
    }
  }

  const merged = new Map<string, Dep>();
  const files: LockfileInfo[] = [];
  const problems: string[] = [];

  for (const candidate of candidates) {
    const abs = path.join(root, candidate.rel);
    const text = fs.readFileSync(abs, "utf8");
    const parsed =
      candidate.ecosystem === "npm"
        ? parseNpmLock(text, candidate.rel)
        : parseRequirements(text, candidate.rel, {
            dev: candidate.dev,
            readInclude: (relPath, fromSource) => {
              const target = path.resolve(root, path.dirname(fromSource), relPath);
              if (!target.startsWith(path.resolve(root))) return null; // never read outside the repo
              return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
            },
          });
    problems.push(...parsed.problems);
    files.push({ path: candidate.rel, ecosystem: candidate.ecosystem, count: parsed.deps.length });
    for (const dep of parsed.deps) {
      const key = `${dep.ecosystem}:${dep.name}@${dep.version}`;
      const existing = merged.get(key);
      if (existing === undefined) {
        merged.set(key, { ...dep, sources: [...dep.sources] });
      } else {
        existing.dev = existing.dev && dep.dev;
        for (const s of dep.sources) {
          if (!existing.sources.includes(s)) existing.sources.push(s);
        }
      }
    }
  }

  const deps = [...merged.values()].sort(
    (a, b) =>
      a.ecosystem.localeCompare(b.ecosystem) ||
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version)
  );
  return { deps, files, problems: problems.sort() };
}
