// Suggestions: certified-version discovery, closest-base selection and
// the generated vouch command. A wrong base means a human reviews a
// bigger diff than necessary, so the ordering edge cases matter.
import test from "node:test";
import assert from "node:assert/strict";
import { buildCriteriaTable, certifiedVersions, pickBase, suggestFor } from "../dist/index.js";
import { vouch } from "./helpers.mjs";

const TABLE = buildCriteriaTable();

function dep(overrides = {}) {
  return {
    ecosystem: "npm",
    name: "left-pad",
    version: "1.4.0",
    dev: false,
    sources: ["package-lock.json"],
    ...overrides,
  };
}

function sourced(v) {
  return { ...v, origin: null };
}

test("certifiedVersions includes full vouches and delta-reachable versions, never the target", () => {
  const vouches = [
    sourced(vouch({ version: "1.0.0" })),
    sourced(vouch({ from: "1.0.0", version: "1.2.0" })),
    sourced(vouch({ from: "9.0.0", version: "9.1.0" })), // dangling delta — not certified
    sourced(vouch({ version: "1.4.0" })), // the target itself — excluded
  ];
  const certified = certifiedVersions(dep(), ["safe-to-deploy"], vouches, TABLE);
  assert.deepEqual(certified, ["1.0.0", "1.2.0"]);
});

test("certifiedVersions requires every criterion, not just one", () => {
  const vouches = [sourced(vouch({ version: "1.0.0", criteria: ["safe-to-run"] }))];
  assert.deepEqual(certifiedVersions(dep(), ["safe-to-run"], vouches, TABLE), ["1.0.0"]);
  assert.deepEqual(certifiedVersions(dep(), ["safe-to-run", "safe-to-deploy"], vouches, TABLE), []);
});

test("pickBase: highest version below the target, else lowest above, else null", () => {
  assert.equal(pickBase("1.4.0", ["1.0.0", "1.2.0", "2.0.0"]), "1.2.0");
  assert.equal(pickBase("0.9.0", ["1.0.0", "2.0.0"]), "1.0.0");
  assert.equal(pickBase("1.0.0", []), null);
});

test("suggestFor emits a delta command when a base exists", () => {
  const vouches = [sourced(vouch({ version: "1.2.0" }))];
  const s = suggestFor(dep(), ["safe-to-deploy"], vouches, TABLE);
  assert.equal(s.base, "1.2.0");
  assert.equal(
    s.command,
    "depvouch vouch left-pad@1.4.0 --eco npm --from 1.2.0 --criteria safe-to-deploy --by <you>"
  );
});

test("suggestFor emits a full-review command when no base exists, criteria comma-joined", () => {
  const s = suggestFor(dep(), ["safe-to-deploy"], [], TABLE);
  assert.equal(s.base, null);
  assert.equal(
    s.command,
    "depvouch vouch left-pad@1.4.0 --eco npm --criteria safe-to-deploy --by <you>"
  );
  const table = buildCriteriaTable({ audited: { description: "d", implies: [] } });
  const multi = suggestFor(dep(), ["safe-to-deploy", "audited"], [], table);
  assert.match(multi.command, /--criteria safe-to-deploy,audited/);
});
