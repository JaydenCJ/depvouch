// Argument parsing: subcommand routing, the check default, package-spec
// parsing (including scoped npm names) and the typed usage errors that
// keep exit code 2 honest.
import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, parseSpec, UsageError } from "../dist/index.js";

test("check is the default: no arguments means `check .`, a bare directory routes to it", () => {
  const cmd = parseArgs([]);
  assert.equal(cmd.kind, "check");
  assert.equal(cmd.root, ".");
  assert.equal(cmd.format, "text");
  const withDir = parseArgs(["some/dir"]);
  assert.equal(withDir.kind, "check");
  assert.equal(withDir.root, "some/dir");
});

test("check flags: --format json, --quiet, --no-exemptions", () => {
  const cmd = parseArgs(["check", ".", "--format", "json", "-q", "--no-exemptions"]);
  assert.equal(cmd.format, "json");
  assert.equal(cmd.quiet, true);
  assert.equal(cmd.noExemptions, true);
});

test("parseSpec handles plain, versioned-prerelease and scoped names", () => {
  assert.deepEqual(parseSpec("left-pad@1.3.0"), { name: "left-pad", version: "1.3.0" });
  assert.deepEqual(parseSpec("pkg@2.0.0-rc.1"), { name: "pkg", version: "2.0.0-rc.1" });
  assert.deepEqual(parseSpec("@types/node@22.5.0"), { name: "@types/node", version: "22.5.0" });
});

test("parseSpec rejects specs without a version or without a name", () => {
  assert.throws(() => parseSpec("left-pad"), UsageError);
  assert.throws(() => parseSpec("@1.2.3"), UsageError);
  assert.throws(() => parseSpec("left-pad@"), UsageError);
});

test("vouch collects its flags and splits --criteria on commas", () => {
  const cmd = parseArgs([
    "vouch",
    "left-pad@1.3.0",
    "--eco",
    "npm",
    "--criteria",
    "safe-to-run, safe-to-deploy",
    "--by",
    "alice",
    "--from",
    "1.2.0",
    "--date",
    "2026-07-13",
  ]);
  assert.equal(cmd.kind, "vouch");
  assert.deepEqual(cmd.criteria, ["safe-to-run", "safe-to-deploy"]);
  assert.equal(cmd.from, "1.2.0");
  assert.equal(cmd.by, "alice");
});

test("unknown flags, missing values, bad enums and a stray spec are usage errors", () => {
  assert.throws(() => parseArgs(["left-pad@1.3.0"]), /did you mean `depvouch vouch/);
  assert.throws(() => parseArgs(["check", "--frobnicate"]), UsageError);
  assert.throws(() => parseArgs(["vouch", "a@1", "--by"]), /--by needs a value/);
  assert.throws(() => parseArgs(["check", "--format", "yaml"]), /--format must be text or json/);
  assert.throws(() => parseArgs(["vouch", "a@1", "--eco", "cargo"]), /--eco must be npm or pypi/);
  assert.throws(() => parseArgs(["check", "a", "b"]), /unexpected argument/);
});

test("explain requires a topic; import requires a file", () => {
  assert.throws(() => parseArgs(["explain"]), UsageError);
  assert.throws(() => parseArgs(["import"]), UsageError);
  assert.equal(parseArgs(["explain", "criteria"]).topic, "criteria");
  const imp = parseArgs(["import", "team.json", "--as", "acme"]);
  assert.equal(imp.file, "team.json");
  assert.equal(imp.as, "acme");
});

test("--help and --version win regardless of position", () => {
  assert.equal(parseArgs(["vouch", "a@1", "--help"]).kind, "help");
  assert.equal(parseArgs(["--version"]).kind, "version");
});
