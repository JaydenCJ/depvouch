// The criteria table: built-ins, custom criteria, implication closure and
// the validation that keeps a broken config from silently weakening the
// gate (unknown names, redefined built-ins, implication cycles).
import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_CRITERIA,
  buildCriteriaTable,
  closureOf,
  satisfies,
  LedgerError,
} from "../dist/index.js";

test("safe-to-deploy implies safe-to-run out of the box, never the reverse", () => {
  const table = buildCriteriaTable();
  assert.ok(satisfies(["safe-to-deploy"], "safe-to-run", table));
  assert.ok(!satisfies(["safe-to-run"], "safe-to-deploy", table));
});

test("closure is transitive and includes the criterion itself", () => {
  const table = buildCriteriaTable({
    "crypto-reviewed": { description: "d", implies: ["safe-to-deploy"] },
  });
  const closure = closureOf(["crypto-reviewed"], table);
  assert.deepEqual([...closure].sort(), ["crypto-reviewed", "safe-to-deploy", "safe-to-run"]);
});

test("unknown criteria names never satisfy anything and never throw at resolve time", () => {
  const table = buildCriteriaTable();
  assert.ok(!satisfies(["made-up"], "safe-to-run", table));
  assert.equal(closureOf(["made-up"], table).size, 0);
});

test("custom criteria may imply other custom criteria", () => {
  const table = buildCriteriaTable({
    "audited": { description: "d", implies: ["pinned"] },
    "pinned": { description: "d", implies: [] },
  });
  assert.ok(satisfies(["audited"], "pinned", table));
});

test("table validation rejects redefined built-ins, unknown targets, cycles and bad names", () => {
  assert.throws(
    () => buildCriteriaTable({ "safe-to-run": { description: "weaker", implies: [] } }),
    LedgerError
  );
  assert.throws(
    () => buildCriteriaTable({ ok: { description: "d", implies: ["ghost"] } }),
    /`ok` implies unknown criteria `ghost`/
  );
  assert.throws(
    () =>
      buildCriteriaTable({
        a: { description: "d", implies: ["b"] },
        b: { description: "d", implies: ["a"] },
      }),
    /cycle/
  );
  assert.throws(
    () => buildCriteriaTable({ "Not OK": { description: "d", implies: [] } }),
    /invalid criteria name/
  );
});

test("built-in descriptions are real prose, not placeholders", () => {
  for (const def of Object.values(BUILTIN_CRITERIA)) {
    assert.ok(def.description.length > 40);
  }
});
