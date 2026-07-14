// requirements.txt extraction: exact pins, comments, continuations,
// hashes, markers, extras, includes with cycle guards — and the unpinned
// or URL requirements that must fail the gate as problems, because a
// version nobody can name is a version nobody can vouch for.
import test from "node:test";
import assert from "node:assert/strict";
import { parseRequirements } from "../dist/index.js";

function names(deps) {
  return deps.map((d) => `${d.name}@${d.version}`).sort();
}

test("exact == and === pins are extracted with PEP 503 canonical names", () => {
  const { deps, problems } = parseRequirements(
    "requests==2.32.3\nDjango==5.0.6\nzope.interface==6.4\nweird===1.0-custom\n",
    "requirements.txt"
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(names(deps), [
    "django@5.0.6",
    "requests@2.32.3",
    "weird@1.0-custom",
    "zope-interface@6.4",
  ]);
  assert.ok(deps.every((d) => d.ecosystem === "pypi"));
});

test("comments, blank lines, continuations and --hash attestations parse like pip", () => {
  const text =
    "# lockfile\n\nflask==3.0.3  # web framework\n   # indented comment\n" +
    "cryptography==42.0.8 \\\n" +
    "    --hash=sha256:0000000000000000000000000000000000000000000000000000000000000000 \\\n" +
    "    --hash=sha256:1111111111111111111111111111111111111111111111111111111111111111\n";
  const { deps, problems } = parseRequirements(text, "requirements.txt");
  assert.deepEqual(problems, []);
  assert.deepEqual(names(deps), ["cryptography@42.0.8", "flask@3.0.3"]);
});

test("environment markers and extras do not change the reviewed identity", () => {
  const { deps, problems } = parseRequirements(
    'uvicorn[standard]==0.30.1 ; python_version >= "3.9"\n',
    "requirements.txt"
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(names(deps), ["uvicorn@0.30.1"]);
});

test("ranges, bare names and wildcard pins are problems, not dependencies", () => {
  const { deps, problems } = parseRequirements(
    "flask>=2.0\nrequests\nnumpy==1.26.*\n",
    "requirements.txt"
  );
  assert.equal(deps.length, 0);
  assert.equal(problems.length, 3);
  assert.match(problems.join("\n"), /flask.*not pinned/);
  assert.match(problems.join("\n"), /requests.*no version pin/);
  assert.match(problems.join("\n"), /numpy.*not pinned/);
});

test("URL, path and editable requirements are problems", () => {
  const { deps, problems } = parseRequirements(
    "git+https://example.test/repo.git#egg=thing\n./vendored/pkg\n-e ./src/mypkg\n",
    "requirements.txt"
  );
  assert.equal(deps.length, 0);
  assert.equal(problems.length, 3);
  assert.match(problems.join("\n"), /URL or path/);
  assert.match(problems.join("\n"), /editable/);
});

test("index options and constraints are skipped silently; unknown options are reported", () => {
  const { deps, problems } = parseRequirements(
    "--index-url https://127.0.0.1:8080/simple\n--require-hashes\n-c constraints.txt\n--frobnicate\nflask==3.0.3\n",
    "requirements.txt"
  );
  assert.deepEqual(names(deps), ["flask@3.0.3"]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /--frobnicate/);
});

test("-r includes are resolved through the callback and merged", () => {
  const files = {
    "base.txt": "requests==2.32.3\n",
  };
  const { deps, problems } = parseRequirements("-r base.txt\nflask==3.0.3\n", "requirements.txt", {
    readInclude: (rel) => files[rel] ?? null,
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(names(deps), ["flask@3.0.3", "requests@2.32.3"]);
});

test("include cycles and unreadable includes are reported instead of recursing or crashing", () => {
  const files = {
    "a.txt": "-r b.txt\n",
    "b.txt": "-r a.txt\nflask==3.0.3\n",
  };
  const cyclic = parseRequirements("-r a.txt\n", "requirements.txt", {
    readInclude: (rel) => files[rel] ?? null,
  });
  assert.deepEqual(names(cyclic.deps), ["flask@3.0.3"]);
  assert.equal(cyclic.problems.length, 1);
  assert.match(cyclic.problems[0], /include cycle/);

  const missing = parseRequirements("-r missing.txt\n", "requirements.txt", {
    readInclude: () => null,
  });
  assert.match(missing.problems[0], /missing\.txt.*cannot be read/);
});

test("the dev flag marks every requirement from a dev lockfile", () => {
  const { deps } = parseRequirements("pytest==8.2.2\n", "requirements-dev.txt", { dev: true });
  assert.equal(deps[0].dev, true);
});
