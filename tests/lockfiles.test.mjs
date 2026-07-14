// Lockfile discovery and merging: default candidates, configured lists,
// cross-file deduplication, dev-twin requirements files and the refusal
// to read includes outside the repo.
import test from "node:test";
import assert from "node:assert/strict";
import { LedgerError, scanLockfiles, classifyLockfile } from "../dist/index.js";
import { withRepo, npmLock } from "./helpers.mjs";

test("default discovery finds package-lock.json and requirements.txt at the root", () => {
  withRepo(
    {
      "package-lock.json": npmLock({ "left-pad": "1.3.0" }),
      "requirements.txt": "flask==3.0.3\n",
    },
    (dir) => {
      const scan = scanLockfiles(dir);
      assert.deepEqual(
        scan.files.map((f) => `${f.path}:${f.ecosystem}:${f.count}`),
        ["package-lock.json:npm:1", "requirements.txt:pypi:1"]
      );
      assert.equal(scan.deps.length, 2);
    }
  );
});

test("requirements-dev.txt marks its packages as dev dependencies", () => {
  withRepo({ "requirements-dev.txt": "pytest==8.2.2\n" }, (dir) => {
    const scan = scanLockfiles(dir);
    assert.equal(scan.deps[0].dev, true);
  });
});

test("a package pinned by two lockfiles is one dependency with both sources", () => {
  withRepo(
    {
      "requirements.txt": "shared==1.0.0\n",
      "requirements-dev.txt": "shared==1.0.0\npytest==8.2.2\n",
    },
    (dir) => {
      const scan = scanLockfiles(dir);
      const shared = scan.deps.find((d) => d.name === "shared");
      assert.deepEqual(shared.sources, ["requirements.txt", "requirements-dev.txt"]);
      assert.equal(shared.dev, false, "a runtime occurrence wins over a dev one");
    }
  );
});

test("deps are returned in a deterministic sorted order", () => {
  withRepo(
    {
      "package-lock.json": npmLock({ zzz: "1.0.0", aaa: "2.0.0" }),
      "requirements.txt": "mmm==3.0.0\n",
    },
    (dir) => {
      const scan = scanLockfiles(dir);
      assert.deepEqual(
        scan.deps.map((d) => `${d.ecosystem}:${d.name}`),
        ["npm:aaa", "npm:zzz", "pypi:mmm"]
      );
    }
  );
});

test("a configured lockfile list overrides discovery and must exist", () => {
  withRepo(
    {
      "locks/prod-requirements.txt": "flask==3.0.3\n",
      "requirements.txt": "ignored==1.0.0\n",
    },
    (dir) => {
      const scan = scanLockfiles(dir, ["locks/prod-requirements.txt"]);
      assert.deepEqual(scan.deps.map((d) => d.name), ["flask"]);
      assert.throws(() => scanLockfiles(dir, ["missing.txt"]), /does not exist/);
      assert.throws(() => classifyLockfile("poetry.lock"), LedgerError);
      assert.equal(classifyLockfile("sub/package-lock.json").ecosystem, "npm");
      assert.equal(classifyLockfile("requirements-dev.txt").dev, true);
    }
  );
});

test("-r includes resolve relative to the including file, inside the repo only", () => {
  withRepo(
    {
      "reqs/requirements.txt": "-r base.txt\n",
      "reqs/base.txt": "flask==3.0.3\n",
    },
    (dir) => {
      const scan = scanLockfiles(dir, ["reqs/requirements.txt"]);
      assert.deepEqual(scan.deps.map((d) => d.name), ["flask"]);
    }
  );
  withRepo({ "requirements.txt": "-r ../../outside.txt\n" }, (dir) => {
    const scan = scanLockfiles(dir);
    assert.equal(scan.deps.length, 0);
    assert.match(scan.problems[0], /cannot be read/);
  });
});

test("problems from every lockfile are aggregated and sorted", () => {
  withRepo(
    {
      "package-lock.json": "{ broken",
      "requirements.txt": "flask>=2.0\n",
    },
    (dir) => {
      const scan = scanLockfiles(dir);
      assert.equal(scan.problems.length, 2);
      assert.deepEqual([...scan.problems].sort(), scan.problems);
    }
  );
});
