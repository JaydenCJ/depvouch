/**
 * Ecosystem-neutral version and name handling. Coverage in the ledger is
 * decided by **exact canonical match** — depvouch never guesses that
 * `1.2` means `1.2.0`. Ordering (`compareVersions`) is only used to rank
 * suggestions ("which vouched version is closest to the one you need"),
 * so it accepts both semver (`1.2.3-rc.1+build`) and PEP 440-ish forms
 * (`2.1.0rc1`, `1!2.0`, `1.0.post2`) without being a full implementation
 * of either spec.
 */

/** Canonicalize a package name for matching. PEP 503 for PyPI; npm names are already canonical. */
export function canonicalName(ecosystem: "npm" | "pypi", name: string): string {
  if (ecosystem === "pypi") return name.toLowerCase().replace(/[-_.]+/g, "-");
  return name;
}

/** Canonicalize a version string for exact matching: trim, lowercase, drop a leading `v` or `=`. */
export function canonicalVersion(v: string): string {
  return v.trim().toLowerCase().replace(/^[=v]+/, "");
}

type PreToken = number | string;

interface ParsedVersion {
  core: number[];
  pre: PreToken[];
  /** PEP 440 post-releases (`1.0.post1`) sort *after* the release. */
  post: boolean;
}

function pushTokens(out: PreToken[], text: string): void {
  for (const tok of text.match(/\d+|[a-z]+/g) ?? []) {
    out.push(/^\d/.test(tok) ? Number(tok) : tok);
  }
}

export function parseVersion(v: string): ParsedVersion {
  let s = canonicalVersion(v);
  const plus = s.indexOf("+");
  if (plus >= 0) s = s.slice(0, plus); // build metadata never orders
  let epoch = 0;
  const bang = s.indexOf("!");
  if (bang >= 0) {
    epoch = Number(s.slice(0, bang)) || 0;
    s = s.slice(bang + 1);
  }
  let coreStr = s;
  let preStr = "";
  const dash = s.indexOf("-");
  if (dash >= 0) {
    coreStr = s.slice(0, dash);
    preStr = s.slice(dash + 1);
  }
  const core: number[] = [epoch];
  const pre: PreToken[] = [];
  let inPre = false;
  for (const seg of coreStr.split(".")) {
    if (seg === "") continue;
    if (!inPre && /^\d+$/.test(seg)) {
      core.push(Number(seg));
      continue;
    }
    const m = /^(\d+)(.+)$/.exec(seg);
    if (!inPre && m !== null) {
      // PEP 440 style "2.1.0rc1": digits close the core, the tail opens the pre-release.
      core.push(Number(m[1]));
      pushTokens(pre, m[2] as string);
    } else {
      pushTokens(pre, seg);
    }
    inPre = true;
  }
  if (preStr !== "") {
    for (const part of preStr.split(".")) pushTokens(pre, part);
  }
  let post = false;
  if (pre.length > 0 && (pre[0] === "post" || pre[0] === "rev" || pre[0] === "r")) {
    post = true;
    pre.shift();
  }
  return { core, pre, post };
}

function rank(p: ParsedVersion): number {
  if (p.post) return 2; // 1.0.post1 > 1.0
  if (p.pre.length > 0) return 0; // 1.0rc1 < 1.0
  return 1;
}

function comparePre(a: PreToken[], b: PreToken[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1; // shorter pre-release sorts first (semver rule 11)
    if (y === undefined) return 1;
    const xNum = typeof x === "number";
    const yNum = typeof y === "number";
    if (xNum && yNum) {
      if (x !== y) return x < y ? -1 : 1;
    } else if (xNum) {
      return -1; // numeric identifiers sort before alphanumeric
    } else if (yNum) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Total order over version strings: -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const n = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < n; i++) {
    const x = pa.core[i] ?? 0;
    const y = pb.core[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (rank(pa) !== rank(pb)) return rank(pa) < rank(pb) ? -1 : 1;
  return comparePre(pa.pre, pb.pre);
}

/** True when the string plausibly names one exact release. */
export function looksLikeExactVersion(v: string): boolean {
  const s = canonicalVersion(v);
  return /^\d/.test(s) && !/[*\s]/.test(s) && s.length > 0;
}
