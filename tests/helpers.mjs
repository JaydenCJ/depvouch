// Shared test helpers: build a throwaway repo tree from a plain object
// (path -> content) inside a fresh temp directory, plus factories for the
// lockfiles and ledger files most tests need. Every test is hermetic: no
// network, no shared state, no reliance on this repository's own tree.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeRepo(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "depvouch-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

export function rmRepo(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Run `fn(dir)` against a temp repo and always clean up. */
export function withRepo(files, fn) {
  const dir = makeRepo(files);
  try {
    return fn(dir);
  } finally {
    rmRepo(dir);
  }
}

/** A v3 package-lock.json with the given `node_modules/<name>` entries. */
export function npmLock(entries) {
  const packages = { "": { name: "fixture", version: "1.0.0" } };
  for (const [name, spec] of Object.entries(entries)) {
    packages[`node_modules/${name}`] = typeof spec === "string" ? { version: spec } : spec;
  }
  return JSON.stringify({ name: "fixture", version: "1.0.0", lockfileVersion: 3, packages }, null, 2);
}

/** Minimal valid ledger files (config + vouches), as a files object to spread. */
export function ledgerFiles({ vouches = [], exemptions = [], config = {} } = {}) {
  return {
    ".depvouch/config.json": JSON.stringify({ version: 1, ...config }, null, 2),
    ".depvouch/vouches.json": JSON.stringify({ version: 1, vouches, exemptions }, null, 2),
  };
}

/** Factory for a vouch entry with sane defaults. */
export function vouch(overrides = {}) {
  return {
    ecosystem: "npm",
    package: "left-pad",
    version: "1.3.0",
    criteria: ["safe-to-deploy"],
    by: "alice",
    date: "2026-07-01",
    ...overrides,
  };
}
