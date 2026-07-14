// End-to-end CLI integration: the compiled dist/cli.js run as a child
// process against temp repos — the full init -> fail -> vouch -> pass
// lifecycle, import/export round-trips, prune, exit codes and the
// usage-error path. This is the same surface scripts/smoke.sh exercises.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { withRepo, ledgerFiles, npmLock, vouch } from "./helpers.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

function run(args, cwd) {
  const res = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

test("--version prints the package version and --help documents the surface", () => {
  const version = run(["--version"]);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), "0.1.0");

  const help = run(["--help"]);
  assert.equal(help.code, 0);
  for (const word of ["init", "check", "vouch", "exempt", "suggest", "import", "export", "prune", "explain", "Exit codes"]) {
    assert.ok(help.stdout.includes(word), `help is missing ${word}`);
  }
});

test("the full lifecycle: init starts green, a new dep fails the gate, a vouch fixes it", () => {
  withRepo({ "package-lock.json": npmLock({ "left-pad": "1.3.0" }) }, (dir) => {
    const init = run(["init", dir]);
    assert.equal(init.code, 0);
    assert.match(init.stdout, /1 existing dependency exempted/);

    assert.equal(run(["check", dir]).code, 0, "the gate starts green");

    const rerun = run(["init", dir]);
    assert.equal(rerun.code, 2, "init refuses to overwrite an existing ledger");
    assert.match(rerun.stderr, /already exists/);

    // Someone adds lodash without a review.
    fs.writeFileSync(
      path.join(dir, "package-lock.json"),
      npmLock({ "left-pad": "1.3.0", lodash: "4.17.21" })
    );
    const fail = run([], dir); // check is the default subcommand, cwd is the default dir
    assert.equal(fail.code, 1);
    assert.match(fail.stdout, /lodash@4\.17\.21 — missing safe-to-deploy/);

    const v = run(["vouch", "lodash@4.17.21", "--by", "alice", "--date", "2026-07-13", "--dir", dir]);
    assert.equal(v.code, 0);
    assert.match(v.stdout, /recorded full vouch for npm:lodash@4\.17\.21/);

    const pass = run(["check", dir]);
    assert.equal(pass.code, 0);
    assert.match(pass.stdout, /depvouch: OK/);
  });
});

test("a missing or broken ledger exits 2, distinct from a failing gate", () => {
  withRepo({ "package-lock.json": npmLock({}) }, (dir) => {
    const r = run(["check", dir]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /run `depvouch init`/);
  });
  withRepo({ ".depvouch/config.json": "{ nope" }, (dir) => {
    const r = run(["check", dir]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not valid JSON/);
  });
});

test("usage errors exit 2 with a message on stderr, not a stack trace", () => {
  const r = run(["--frobnicate"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown flag/);
  assert.doesNotMatch(r.stderr, /at .*\.js:\d+/);
});

test("vouch infers the ecosystem from the lockfiles and rejects ambiguity honestly", () => {
  withRepo(
    {
      "package-lock.json": npmLock({ six: "1.0.0" }),
      "requirements.txt": "six==1.16.0\nflask==3.0.3\n",
      ...ledgerFiles(),
    },
    (dir) => {
      const ok = run(["vouch", "flask@3.0.3", "--by", "bob", "--date", "2026-07-13", "--dir", dir]);
      assert.equal(ok.code, 0);
      assert.match(ok.stdout, /pypi:flask@3\.0\.3/);

      const ambiguous = run(["vouch", "six@1.16.0", "--by", "bob", "--dir", dir]);
      assert.equal(ambiguous.code, 2);
      assert.match(ambiguous.stderr, /more than one ecosystem/);

      const absent = run(["vouch", "ghost@1.0.0", "--by", "bob", "--dir", dir]);
      assert.equal(absent.code, 2);
      assert.match(absent.stderr, /not in any lockfile/);
    }
  );
});

test("vouch validation: --by is mandatory, duplicates are refused, off-lockfile versions get a note", () => {
  withRepo({ "package-lock.json": npmLock({ lodash: "4.17.21" }), ...ledgerFiles() }, (dir) => {
    const anonymous = run(["vouch", "lodash@4.17.21", "--dir", dir]);
    assert.equal(anonymous.code, 2, "the ledger records *who* reviewed");
    assert.match(anonymous.stderr, /--by/);

    const args = ["vouch", "lodash@4.17.21", "--by", "alice", "--date", "2026-07-13", "--dir", dir];
    assert.equal(run(args).code, 0);
    const dup = run(args);
    assert.equal(dup.code, 2);
    assert.match(dup.stderr, /identical vouch/);

    const offLock = run(["vouch", "lodash@9.9.9", "--by", "alice", "--date", "2026-07-13", "--dir", dir]);
    assert.equal(offLock.code, 0, "proactive reviews are allowed");
    assert.match(offLock.stdout, /not in the current lockfiles — recorded anyway/);
  });
});

test("a delta vouch chains from an existing full vouch to satisfy the gate", () => {
  withRepo(
    {
      "package-lock.json": npmLock({ "left-pad": "1.4.0" }),
      ...ledgerFiles({ vouches: [vouch({ version: "1.3.0" })] }),
    },
    (dir) => {
      assert.equal(run(["check", dir]).code, 1);
      const suggest = run(["suggest", dir]);
      assert.match(suggest.stdout, /delta review 1\.3\.0 -> 1\.4\.0/);
      const v = run([
        "vouch", "left-pad@1.4.0", "--from", "1.3.0", "--by", "bob", "--date", "2026-07-13", "--dir", dir,
      ]);
      assert.equal(v.code, 0);
      assert.match(v.stdout, /delta vouch \(1\.3\.0 -> 1\.4\.0\)/);
      assert.equal(run(["check", dir]).code, 0);
    }
  );
});

test("exempt passes the gate without judgment, and --no-exemptions sees through it", () => {
  withRepo({ "package-lock.json": npmLock({ lodash: "4.17.21" }), ...ledgerFiles() }, (dir) => {
    const e = run(["exempt", "lodash@4.17.21", "--note", "vendor bump, review scheduled", "--dir", dir]);
    assert.equal(e.code, 0);
    assert.match(e.stdout, /no judgment recorded/);
    assert.equal(run(["check", dir]).code, 0);
    assert.equal(run(["check", dir, "--no-exemptions"]).code, 1);
    assert.equal(run(["exempt", "lodash@4.17.21", "--dir", dir]).code, 2, "double exemption is refused");
  });
});

test("export -> import: another repo's vouches satisfy this repo's gate with provenance", () => {
  withRepo(
    {
      "package-lock.json": npmLock({ lodash: "4.17.21" }),
      ...ledgerFiles({ vouches: [vouch({ package: "lodash", version: "4.17.21" })] }),
    },
    (producer) => {
      const exported = run(["export", producer]);
      assert.equal(exported.code, 0);
      const payload = JSON.parse(exported.stdout);
      assert.equal(payload.version, 1);
      assert.equal(payload.vouches.length, 1);

      withRepo({ "package-lock.json": npmLock({ lodash: "4.17.21" }), ...ledgerFiles() }, (consumer) => {
        assert.equal(run(["check", consumer]).code, 1);
        const file = path.join(consumer, "team-vouches.json");
        fs.writeFileSync(file, exported.stdout);
        const imp = run(["import", file, "--as", "acme-security", "--date", "2026-07-13", "--dir", consumer]);
        assert.equal(imp.code, 0);
        assert.match(imp.stdout, /imported 1 vouch as source `acme-security`/);

        const check = run(["check", consumer, "--format", "json"]);
        assert.equal(check.code, 0);
        const parsed = JSON.parse(check.stdout);
        assert.equal(parsed.deps[0].via[0].origin, "acme-security");

        const junk = path.join(consumer, "junk.json");
        fs.writeFileSync(junk, JSON.stringify({ hello: 1 }));
        const bad = run(["import", junk, "--as", "x", "--dir", consumer]);
        assert.equal(bad.code, 2, "a non-export file is a clear input error");
        assert.match(bad.stderr, /not a depvouch export/);
      });
    }
  );
});

test("export never leaks exemptions or re-exports imports", () => {
  withRepo(
    ledgerFiles({
      vouches: [vouch()],
      exemptions: [{ ecosystem: "npm", package: "lodash", version: "4.17.21" }],
    }),
    (dir) => {
      fs.writeFileSync(
        path.join(dir, ".depvouch", "imports.json"),
        JSON.stringify({
          version: 1,
          sources: { other: { imported: "2026-07-01", vouches: [vouch({ package: "imported-pkg" })] } },
        })
      );
      const payload = JSON.parse(run(["export", dir]).stdout);
      assert.equal(payload.vouches.length, 1);
      assert.equal(payload.vouches[0].package, "left-pad");
      assert.equal(JSON.stringify(payload).includes("imported-pkg"), false);
      assert.equal(JSON.stringify(payload).includes("exemptions"), false);
    }
  );
});

test("prune drops exemptions covered by vouches or gone from the lockfiles; --dry-run only reports", () => {
  withRepo(
    {
      "package-lock.json": npmLock({ "left-pad": "1.3.0", lodash: "4.17.21" }),
      ...ledgerFiles({
        vouches: [vouch()], // covers left-pad@1.3.0
        exemptions: [
          { ecosystem: "npm", package: "left-pad", version: "1.3.0" }, // now covered
          { ecosystem: "npm", package: "gone", version: "0.0.1" }, // not in lockfile
          { ecosystem: "npm", package: "lodash", version: "4.17.21" }, // still needed
        ],
      }),
    },
    (dir) => {
      const dry = run(["prune", dir, "--dry-run"]);
      assert.equal(dry.code, 0);
      assert.match(dry.stdout, /would drop npm:left-pad@1\.3\.0 — now covered by vouches/);
      assert.match(dry.stdout, /would drop npm:gone@0\.0\.1 — no longer in the lockfiles/);
      assert.match(dry.stdout, /would drop 2 exemptions, 1 remaining/);
      assert.equal(run(["check", dir]).code, 0, "dry-run changed nothing");

      const real = run(["prune", dir]);
      assert.match(real.stdout, /dropped 2 exemptions, 1 remaining/);
      assert.equal(run(["check", dir]).code, 0, "the kept exemption still guards lodash");
      const again = run(["prune", dir]);
      assert.match(again.stdout, /dropped 0 exemptions, 1 remaining/);
    }
  );
});

test("lockfile problems fail the gate even when every dependency is vouched", () => {
  withRepo(
    { "requirements.txt": "flask>=2.0\n", ...ledgerFiles() },
    (dir) => {
      const r = run(["check", dir]);
      assert.equal(r.code, 1);
      assert.match(r.stdout, /PROBLEMS \(1\)/);
      assert.match(r.stdout, /not pinned to an exact version/);
    }
  );
});

test("explain documents every advertised topic offline, and rejects unknown ones", () => {
  for (const topic of ["criteria", "delta", "exemptions", "imports", "ledger", "exit-codes"]) {
    const r = run(["explain", topic]);
    assert.equal(r.code, 0, `explain ${topic} failed`);
    assert.ok(r.stdout.length > 100, `explain ${topic} is too thin`);
  }
  const bad = run(["explain", "nonsense"]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /unknown topic/);
});

test("list prints the ledger inventory", () => {
  withRepo(
    ledgerFiles({
      vouches: [vouch()],
      exemptions: [{ ecosystem: "pypi", package: "flask", version: "3.0.3" }],
    }),
    (dir) => {
      const r = run(["list", dir]);
      assert.equal(r.code, 0);
      assert.match(r.stdout, /vouches \(1\)/);
      assert.match(r.stdout, /exemptions \(1\)/);
      assert.match(r.stdout, /imported sources \(0\)/);
    }
  );
});

test("check output is byte-identical across runs", () => {
  withRepo(
    {
      "package-lock.json": npmLock({ lodash: "4.17.21", "left-pad": "1.4.0" }),
      "requirements.txt": "flask==3.0.3\n",
      ...ledgerFiles({ vouches: [vouch({ version: "1.3.0" })] }),
    },
    (dir) => {
      const a = run(["check", dir]);
      const b = run(["check", dir]);
      assert.equal(a.stdout, b.stdout);
      const ja = run(["check", dir, "--format", "json"]);
      const jb = run(["check", dir, "--format", "json"]);
      assert.equal(ja.stdout, jb.stdout);
    }
  );
});

