// The resolution engine: full vouches, delta chains, criteria
// implication across chains, imports, exemption fallback and policy
// routing. These are the semantics the whole tool stands on.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCriteriaTable,
  chainFor,
  requiredCriteriaFor,
  resolveDep,
  resolveAll,
} from "../dist/index.js";
import { vouch } from "./helpers.mjs";

const TABLE = buildCriteriaTable();

function dep(overrides = {}) {
  return {
    ecosystem: "npm",
    name: "left-pad",
    version: "1.3.0",
    dev: false,
    sources: ["package-lock.json"],
    ...overrides,
  };
}

function sourced(v) {
  return { ...v, origin: null };
}

test("a full vouch at the exact version satisfies its criteria", () => {
  const verdict = resolveDep(dep(), ["safe-to-deploy"], [sourced(vouch())], TABLE, []);
  assert.equal(verdict.status, "vouched");
  assert.equal(verdict.via.length, 1);
  assert.equal(verdict.via[0].version, "1.3.0");
});

test("criteria implication: safe-to-deploy covers safe-to-run, never the reverse", () => {
  const strong = resolveDep(dep(), ["safe-to-run"], [sourced(vouch())], TABLE, []);
  assert.equal(strong.status, "vouched");
  const weak = sourced(vouch({ criteria: ["safe-to-run"] }));
  const verdict = resolveDep(dep(), ["safe-to-deploy"], [weak], TABLE, []);
  assert.equal(verdict.status, "unvouched");
  assert.deepEqual(verdict.missing, ["safe-to-deploy"]);
});

test("delta chains: full 1.3.0 + delta 1.3.0->1.3.1 + delta 1.3.1->1.4.0 covers 1.4.0", () => {
  const vouches = [
    sourced(vouch()),
    sourced(vouch({ from: "1.3.0", version: "1.3.1", by: "bob" })),
    sourced(vouch({ from: "1.3.1", version: "1.4.0", by: "carol" })),
  ];
  const verdict = resolveDep(dep({ version: "1.4.0" }), ["safe-to-deploy"], vouches, TABLE, []);
  assert.equal(verdict.status, "vouched");
  assert.deepEqual(
    verdict.via.map((v) => v.by),
    ["alice", "bob", "carol"],
    "the chain is reported full-vouch first, then deltas in order"
  );
});

test("a delta with no full vouch at its base proves nothing", () => {
  const vouches = [sourced(vouch({ from: "1.3.0", version: "1.4.0" }))];
  const verdict = resolveDep(dep({ version: "1.4.0" }), ["safe-to-deploy"], vouches, TABLE, []);
  assert.equal(verdict.status, "unvouched");
});

test("every link in a chain must carry the required criterion", () => {
  const vouches = [
    sourced(vouch()), // full, safe-to-deploy
    sourced(vouch({ from: "1.3.0", version: "1.4.0", criteria: ["safe-to-run"] })), // weak link
  ];
  const strict = resolveDep(dep({ version: "1.4.0" }), ["safe-to-deploy"], vouches, TABLE, []);
  assert.equal(strict.status, "unvouched");
  const relaxed = resolveDep(dep({ version: "1.4.0" }), ["safe-to-run"], vouches, TABLE, []);
  assert.equal(relaxed.status, "vouched");
});

test("chainFor finds the shortest chain when several exist", () => {
  const vouches = [
    sourced(vouch({ version: "1.0.0" })),
    sourced(vouch({ from: "1.0.0", version: "2.0.0" })),
    sourced(vouch({ version: "2.0.0", by: "dave" })), // direct full vouch — shorter
  ];
  const chain = chainFor("2.0.0", "safe-to-deploy", vouches, TABLE);
  assert.equal(chain.length, 1);
  assert.equal(chain[0].by, "dave");
});

test("cyclic deltas terminate and still find a valid chain", () => {
  const vouches = [
    sourced(vouch({ version: "1.0.0" })),
    sourced(vouch({ from: "2.0.0", version: "3.0.0" })),
    sourced(vouch({ from: "3.0.0", version: "2.0.0" })), // downgrade delta forms a cycle
    sourced(vouch({ from: "1.0.0", version: "2.0.0" })),
  ];
  const verdict = resolveDep(dep({ version: "3.0.0" }), ["safe-to-deploy"], vouches, TABLE, []);
  assert.equal(verdict.status, "vouched");
});

test("version matching is exact: 1.4 does not cover 1.4.0", () => {
  const vouches = [sourced(vouch({ version: "1.4" }))];
  const verdict = resolveDep(dep({ version: "1.4.0" }), ["safe-to-deploy"], vouches, TABLE, []);
  assert.equal(verdict.status, "unvouched");
});

test("pypi name forms unify within an ecosystem; ecosystems themselves never cross", () => {
  const pypiVouch = [
    sourced(vouch({ ecosystem: "pypi", package: "Typing_Extensions", version: "4.12.2" })),
  ];
  const unified = resolveDep(
    dep({ ecosystem: "pypi", name: "typing-extensions", version: "4.12.2" }),
    ["safe-to-deploy"],
    pypiVouch,
    TABLE,
    []
  );
  assert.equal(unified.status, "vouched");

  const npmVouch = [sourced(vouch({ package: "six", version: "1.16.0" }))];
  const crossed = resolveDep(
    dep({ ecosystem: "pypi", name: "six", version: "1.16.0" }),
    ["safe-to-deploy"],
    npmVouch,
    TABLE,
    []
  );
  assert.equal(crossed.status, "unvouched");
});

test("exemptions only apply after vouching fails, and only for the exact version", () => {
  const exemptions = [{ ecosystem: "npm", package: "left-pad", version: "1.3.0" }];
  const exempted = resolveDep(dep(), ["safe-to-deploy"], [], TABLE, exemptions);
  assert.equal(exempted.status, "exempted");
  const other = resolveDep(dep({ version: "1.3.1" }), ["safe-to-deploy"], [], TABLE, exemptions);
  assert.equal(other.status, "unvouched");
  // With a vouch present, the verdict is vouched even though an exemption matches.
  const both = resolveDep(dep(), ["safe-to-deploy"], [sourced(vouch())], TABLE, exemptions);
  assert.equal(both.status, "vouched");
});

test("requiredCriteriaFor: policy override beats dev/default routing", () => {
  const config = {
    defaultCriteria: ["safe-to-deploy"],
    devCriteria: ["safe-to-run"],
    criteria: {},
    policy: { "npm:left-pad": { criteria: ["safe-to-run"] } },
    lockfiles: [],
  };
  assert.deepEqual(requiredCriteriaFor(dep(), config), ["safe-to-run"]);
  assert.deepEqual(requiredCriteriaFor(dep({ name: "other" }), config), ["safe-to-deploy"]);
  assert.deepEqual(requiredCriteriaFor(dep({ name: "other", dev: true }), config), ["safe-to-run"]);
});

test("resolveAll: imported vouches count and carry their origin", () => {
  const ledger = {
    config: {
      defaultCriteria: ["safe-to-deploy"],
      devCriteria: ["safe-to-run"],
      criteria: {},
      policy: {},
      lockfiles: [],
    },
    vouches: [],
    exemptions: [],
    imports: {
      "acme-security": { imported: "2026-07-01", vouches: [vouch()] },
    },
  };
  const results = resolveAll([dep()], ledger, TABLE);
  assert.equal(results[0].verdict.status, "vouched");
  assert.equal(results[0].verdict.via[0].origin, "acme-security");
});

test("resolveAll with ignoreExemptions surfaces the real unreviewed set", () => {
  const ledger = {
    config: {
      defaultCriteria: ["safe-to-deploy"],
      devCriteria: ["safe-to-run"],
      criteria: {},
      policy: {},
      lockfiles: [],
    },
    vouches: [],
    exemptions: [{ ecosystem: "npm", package: "left-pad", version: "1.3.0" }],
    imports: {},
  };
  assert.equal(resolveAll([dep()], ledger, TABLE)[0].verdict.status, "exempted");
  assert.equal(
    resolveAll([dep()], ledger, TABLE, { ignoreExemptions: true })[0].verdict.status,
    "unvouched"
  );
});
