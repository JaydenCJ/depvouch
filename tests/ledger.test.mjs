// Ledger persistence: loading validates eagerly with precise messages,
// saving is deterministic (sorted entries, stable key order, trailing
// newline) so ledger diffs stay reviewable, and init seeds exemptions
// exactly once.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  LedgerError,
  initLedger,
  ledgerExists,
  loadLedger,
  saveVouches,
  saveImports,
} from "../dist/index.js";
import { withRepo, ledgerFiles, vouch } from "./helpers.mjs";

test("a missing ledger tells the user to run init", () => {
  withRepo({}, (dir) => {
    assert.equal(ledgerExists(dir), false);
    assert.throws(() => loadLedger(dir), /run `depvouch init`/);
  });
});

test("a minimal ledger loads with the documented defaults", () => {
  withRepo(ledgerFiles(), (dir) => {
    const ledger = loadLedger(dir);
    assert.deepEqual(ledger.config.defaultCriteria, ["safe-to-deploy"]);
    assert.deepEqual(ledger.config.devCriteria, ["safe-to-run"]);
    assert.deepEqual(ledger.vouches, []);
    assert.deepEqual(ledger.exemptions, []);
    assert.deepEqual(ledger.imports, {});
  });
});

test("config kebab-case keys round-trip into the typed config", () => {
  withRepo(
    ledgerFiles({
      config: {
        "default-criteria": ["safe-to-run"],
        "dev-criteria": ["safe-to-run"],
        policy: { "npm:left-pad": { criteria: ["safe-to-deploy"] } },
        lockfiles: ["package-lock.json"],
      },
    }),
    (dir) => {
      const ledger = loadLedger(dir);
      assert.deepEqual(ledger.config.defaultCriteria, ["safe-to-run"]);
      assert.deepEqual(ledger.config.policy["npm:left-pad"], { criteria: ["safe-to-deploy"] });
      assert.deepEqual(ledger.config.lockfiles, ["package-lock.json"]);
    }
  );
});

test("vouches referencing unknown criteria are rejected at load time", () => {
  withRepo(ledgerFiles({ vouches: [vouch({ criteria: ["ghost"] })] }), (dir) => {
    assert.throws(() => loadLedger(dir), /unknown criteria `ghost`/);
  });
});

test("a delta whose from equals version is rejected with the array index", () => {
  withRepo(ledgerFiles({ vouches: [vouch({ from: "1.3.0", version: "1.3.0" })] }), (dir) => {
    assert.throws(() => loadLedger(dir), /vouches\[0\].*`from` equals `version`/);
  });
});

test("malformed entries name the file, the index and the field", () => {
  withRepo(ledgerFiles({ vouches: [vouch({ by: undefined })] }), (dir) => {
    assert.throws(() => loadLedger(dir), /vouches\[0\]: missing `by`/);
  });
  withRepo(ledgerFiles({ vouches: [vouch({ date: "last tuesday" })] }), (dir) => {
    assert.throws(() => loadLedger(dir), /`date` must be YYYY-MM-DD/);
  });
  withRepo(ledgerFiles({ vouches: [vouch({ ecosystem: "cargo" })] }), (dir) => {
    assert.throws(() => loadLedger(dir), /unknown ecosystem `cargo`/);
  });
  withRepo({ ".depvouch/config.json": JSON.stringify({ version: 2 }) }, (dir) => {
    assert.throws(() => loadLedger(dir), /unsupported ledger version/);
  });
});

test("saveVouches writes sorted, stable, newline-terminated JSON", () => {
  withRepo(ledgerFiles(), (dir) => {
    const b = vouch({ package: "zzz", version: "1.0.0" });
    const a = vouch({ package: "aaa", version: "1.0.0" });
    saveVouches(dir, [b, a], []);
    const text = fs.readFileSync(path.join(dir, ".depvouch", "vouches.json"), "utf8");
    assert.ok(text.endsWith("\n"));
    assert.ok(text.indexOf('"aaa"') < text.indexOf('"zzz"'), "entries are sorted");
    const again = () => {
      saveVouches(dir, [a, b], []); // different input order
      return fs.readFileSync(path.join(dir, ".depvouch", "vouches.json"), "utf8");
    };
    assert.equal(again(), text, "output is order-independent");
  });
});

test("imports round-trip, and may carry criteria this repo has not defined", () => {
  withRepo(ledgerFiles(), (dir) => {
    saveImports(dir, {
      "acme-security": { imported: "2026-07-01", vouches: [vouch()] },
      other: { imported: "2026-07-01", vouches: [vouch({ criteria: ["their-custom-bar"] })] },
    });
    const ledger = loadLedger(dir); // must not throw on foreign criteria
    assert.equal(ledger.imports["acme-security"].vouches.length, 1);
    assert.equal(ledger.imports["acme-security"].vouches[0].package, "left-pad");
    assert.equal(ledger.imports["other"].vouches[0].criteria[0], "their-custom-bar");
  });
});

test("initLedger seeds one exemption per current dependency and refuses to run twice", () => {
  withRepo({}, (dir) => {
    const result = initLedger(
      dir,
      [
        { ecosystem: "npm", name: "left-pad", version: "1.3.0" },
        { ecosystem: "pypi", name: "flask", version: "3.0.3" },
      ],
      "2026-07-13"
    );
    assert.equal(result.exempted, 2);
    const ledger = loadLedger(dir);
    assert.equal(ledger.exemptions.length, 2);
    assert.match(ledger.exemptions[0].note, /seeded by depvouch init on 2026-07-13/);
    assert.throws(() => initLedger(dir, [], "2026-07-13"), LedgerError);
  });
});
