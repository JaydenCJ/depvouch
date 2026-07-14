// Report rendering: the text a human reads in a failed CI job and the
// stable JSON a machine parses. Checked through runCheckWithLedger so the
// rendered content reflects real resolution, not hand-built fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import {
  loadLedger,
  renderCheckJson,
  renderCheckText,
  renderList,
  renderSuggestText,
  runCheckWithLedger,
  suggestionsFor,
} from "../dist/index.js";
import { withRepo, ledgerFiles, npmLock, vouch } from "./helpers.mjs";

const FIXTURE = {
  "package-lock.json": npmLock({ "left-pad": "1.4.0", lodash: "4.17.21" }),
  ...ledgerFiles({
    vouches: [vouch({ version: "1.3.0" })], // certified base for left-pad, nothing for lodash
    exemptions: [{ ecosystem: "npm", package: "lodash", version: "4.17.21", note: "seeded" }],
  }),
};

test("text report: unvouched deps get the nearest base and a copy-paste fix command", () => {
  withRepo(FIXTURE, (dir) => {
    const ledger = loadLedger(dir);
    const report = runCheckWithLedger(dir, ledger);
    const text = renderCheckText(report, ledger);
    assert.match(text, /UNVOUCHED \(1\)/);
    assert.match(text, /left-pad@1\.4\.0 — missing safe-to-deploy/);
    assert.match(text, /nearest certified version: 1\.3\.0 — review the 1\.3\.0 -> 1\.4\.0 diff/);
    assert.match(text, /fix: depvouch vouch left-pad@1\.4\.0 --eco npm --from 1\.3\.0/);
    assert.match(text, /depvouch: FAIL — 1 unvouched \(0 vouched, 1 exempted, 1 unvouched\)/);

    const quiet = renderCheckText(runCheckWithLedger(dir, ledger), ledger, { quiet: true });
    assert.doesNotMatch(quiet, /UNVOUCHED/, "quiet keeps the header and verdict only");
    assert.match(quiet, /depvouch: FAIL/);
  });
});

test("JSON report: ok mirrors the gate, unvouched deps carry missing criteria and a suggestion", () => {
  withRepo(FIXTURE, (dir) => {
    const ledger = loadLedger(dir);
    const parsed = JSON.parse(renderCheckJson(runCheckWithLedger(dir, ledger), ledger));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.summary.unvouched, 1);
    const leftPad = parsed.deps.find((d) => d.name === "left-pad");
    assert.deepEqual(leftPad.missing, ["safe-to-deploy"]);
    assert.equal(leftPad.suggestion.base, "1.3.0");
    const lodash = parsed.deps.find((d) => d.name === "lodash");
    assert.equal(lodash.status, "exempted");
    assert.equal(lodash.exemption.note, "seeded");
  });
});

test("a passing report says OK and lists the via chain in JSON", () => {
  withRepo(
    {
      "package-lock.json": npmLock({ "left-pad": "1.3.0" }),
      ...ledgerFiles({ vouches: [vouch()] }),
    },
    (dir) => {
      const ledger = loadLedger(dir);
      const report = runCheckWithLedger(dir, ledger);
      assert.equal(report.ok, true);
      assert.match(renderCheckText(report, ledger), /depvouch: OK — every dependency is accounted for/);
      const parsed = JSON.parse(renderCheckJson(report, ledger));
      assert.equal(parsed.deps[0].via[0].by, "alice");
      assert.equal(parsed.deps[0].via[0].kind, "full");
    }
  );
});

test("suggest rendering covers both the empty and the populated case", () => {
  withRepo(FIXTURE, (dir) => {
    const ledger = loadLedger(dir);
    const report = runCheckWithLedger(dir, ledger, { ignoreExemptions: true });
    const text = renderSuggestText(suggestionsFor(report, ledger));
    assert.match(text, /2 reviews needed for full coverage/);
    assert.match(text, /delta review 1\.3\.0 -> 1\.4\.0/);
    assert.match(text, /lodash@4\.17\.21 — full review/);
  });
  assert.match(renderSuggestText([]), /nothing to suggest/);
});

test("list shows vouches grouped by package, exemptions and import sources deterministically", () => {
  withRepo(FIXTURE, (dir) => {
    const ledger = loadLedger(dir);
    ledger.imports["acme-security"] = { imported: "2026-07-01", vouches: [vouch()] };
    const text = renderList(ledger);
    assert.match(text, /vouches \(1\)/);
    assert.match(text, /npm:left-pad/);
    assert.match(text, /full 1\.3\.0 \(safe-to-deploy, by alice\) on 2026-07-01/);
    assert.match(text, /exemptions \(1\)/);
    assert.match(text, /npm:lodash@4\.17\.21 — seeded/);
    assert.match(text, /acme-security: 1 vouch, imported 2026-07-01/);
    assert.equal(text, renderList(ledger), "rendering is deterministic");
  });
});
