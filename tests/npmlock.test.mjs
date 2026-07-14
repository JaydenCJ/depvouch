// package-lock.json extraction: v2/v3 `packages` maps, the legacy v1
// tree, workspace and link entries, dev flags, aliases and the
// non-registry pins that must surface as problems instead of passing.
import test from "node:test";
import assert from "node:assert/strict";
import { parseNpmLock } from "../dist/index.js";
import { npmLock } from "./helpers.mjs";

function names(deps) {
  return deps.map((d) => `${d.name}@${d.version}`).sort();
}

test("v3 lockfile: extracts name, version and source for every node_modules entry", () => {
  const { deps, problems } = parseNpmLock(
    npmLock({ "left-pad": "1.3.0", "@scope/pkg": "2.0.0" }),
    "sub/package-lock.json"
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(names(deps), ["@scope/pkg@2.0.0", "left-pad@1.3.0"]);
  assert.ok(deps.every((d) => d.ecosystem === "npm"));
  assert.deepEqual(deps[0].sources, ["sub/package-lock.json"]);
});

test("the root entry and first-party workspace packages are skipped", () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "root", version: "1.0.0" },
      "packages/internal-lib": { name: "internal-lib", version: "0.0.1" },
      "node_modules/internal-lib": { link: true, resolved: "packages/internal-lib" },
      "node_modules/lodash": { version: "4.17.21" },
    },
  });
  const { deps, problems } = parseNpmLock(lock, "package-lock.json");
  assert.deepEqual(problems, []);
  assert.deepEqual(names(deps), ["lodash@4.17.21"]);
});

test("nested node_modules paths resolve to the innermost package name", () => {
  const lock = JSON.stringify({
    lockfileVersion: 2,
    packages: {
      "": {},
      "node_modules/a": { version: "1.0.0" },
      "node_modules/a/node_modules/b": { version: "2.0.0" },
    },
  });
  const { deps } = parseNpmLock(lock, "package-lock.json");
  assert.deepEqual(names(deps), ["a@1.0.0", "b@2.0.0"]);
});

test("duplicates collapse to one dependency; dev is true only when every occurrence is dev", () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": {},
      "node_modules/x": { version: "1.0.0", dev: true },
      "node_modules/y/node_modules/x": { version: "1.0.0" }, // same version, runtime path
      "node_modules/y": { version: "3.0.0" },
      "node_modules/z": { version: "9.9.9", dev: true },
    },
  });
  const { deps } = parseNpmLock(lock, "package-lock.json");
  assert.equal(deps.filter((d) => d.name === "x").length, 1);
  assert.equal(deps.find((d) => d.name === "x").dev, false);
  assert.equal(deps.find((d) => d.name === "z").dev, true);
});

test("git, tarball and file pins become problems, never silent passes", () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": {},
      "node_modules/gitdep": { version: "git+https://example.test/x.git#abc" },
      "node_modules/filedep": { version: "file:../local" },
      "node_modules/ok": { version: "1.0.0" },
    },
  });
  const { deps, problems } = parseNpmLock(lock, "package-lock.json");
  assert.deepEqual(names(deps), ["ok@1.0.0"]);
  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /gitdep.*non-registry/);
});

test("legacy v1 tree: recursive dependencies and npm: aliases resolve to real packages", () => {
  const lock = JSON.stringify({
    lockfileVersion: 1,
    dependencies: {
      outer: {
        version: "1.0.0",
        dependencies: { inner: { version: "2.0.0", dev: true } },
      },
      aliased: { version: "npm:real-pkg@3.1.4" },
    },
  });
  const { deps, problems } = parseNpmLock(lock, "package-lock.json");
  assert.deepEqual(problems, []);
  assert.deepEqual(names(deps), ["inner@2.0.0", "outer@1.0.0", "real-pkg@3.1.4"]);
});

test("versionless entries, invalid JSON and non-lockfile JSON each yield one clear problem", () => {
  const versionless = parseNpmLock(
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/broken": {} } }),
    "package-lock.json"
  );
  assert.equal(versionless.deps.length, 0);
  assert.match(versionless.problems[0], /broken.*no version/);

  const bad = parseNpmLock("{ not json", "package-lock.json");
  assert.equal(bad.deps.length, 0);
  assert.match(bad.problems[0], /not valid JSON/);

  const weird = parseNpmLock(JSON.stringify({ hello: 1 }), "package-lock.json");
  assert.match(weird.problems[0], /is this a package-lock\.json/);
});
