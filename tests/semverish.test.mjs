// Version and name canonicalization: exact-match canon forms, and the
// ordering used to rank suggestion bases. Ordering must handle both
// semver pre-releases and PEP 440 forms, because a wrong order silently
// suggests reviewing a *larger* diff than necessary.
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalName,
  canonicalVersion,
  compareVersions,
  looksLikeExactVersion,
} from "../dist/semverish.js";

test("pypi names canonicalize per PEP 503; npm names pass through, scopes intact", () => {
  assert.equal(canonicalName("pypi", "Django"), "django");
  assert.equal(canonicalName("pypi", "zope.interface"), "zope-interface");
  assert.equal(canonicalName("pypi", "typing_extensions"), "typing-extensions");
  assert.equal(canonicalName("pypi", "a--b__c..d"), "a-b-c-d");
  assert.equal(canonicalName("npm", "@types/node-fetch"), "@types/node-fetch");
  assert.equal(canonicalName("npm", "Left-Pad"), "Left-Pad");
});

test("versions canonicalize: trim, lowercase, leading v/= dropped", () => {
  assert.equal(canonicalVersion(" v1.2.3 "), "1.2.3");
  assert.equal(canonicalVersion("=1.0.0"), "1.0.0");
  assert.equal(canonicalVersion("2.1.0RC1"), "2.1.0rc1");
});

test("numeric ordering: multi-digit segments compare numerically, missing segments as zero", () => {
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3", "1.2.10"), -1); // 10 > 3 numerically, not lexically
  assert.equal(compareVersions("2.0.0", "10.0.0"), -1);
  assert.equal(compareVersions("1.10", "1.9"), 1);
  assert.equal(compareVersions("1.2", "1.2.0"), 0); // ordering only — coverage stays exact-match
  assert.equal(compareVersions("1.2", "1.2.1"), -1);
});

test("semver pre-releases sort before the release and among themselves", () => {
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
  assert.equal(compareVersions("1.0.0-alpha.1", "1.0.0-alpha"), 1); // longer pre sorts later
  assert.equal(compareVersions("1.0.0-1", "1.0.0-alpha"), -1); // numeric < alphanumeric
});

test("PEP 440 forms order correctly; build metadata and a leading v never matter", () => {
  assert.equal(compareVersions("2.1.0rc1", "2.1.0"), -1);
  assert.equal(compareVersions("2.1.0rc1", "2.1.0rc2"), -1);
  assert.equal(compareVersions("1.0.post1", "1.0"), 1); // post-releases sort after
  assert.equal(compareVersions("1!1.0", "2.0"), 1); // epoch dominates everything
  assert.equal(compareVersions("1.0.0+build.5", "1.0.0"), 0);
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
});

test("looksLikeExactVersion accepts pins and rejects ranges and wildcards", () => {
  assert.equal(looksLikeExactVersion("1.2.3"), true);
  assert.equal(looksLikeExactVersion("v2.0.0-rc.1"), true);
  assert.equal(looksLikeExactVersion("^1.2.3"), false);
  assert.equal(looksLikeExactVersion("1.2.*"), false);
  assert.equal(looksLikeExactVersion(""), false);
});
