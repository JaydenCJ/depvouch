/**
 * Typed error classes so the CLI can map failures to exit codes without
 * string-matching messages: `UsageError` and `LedgerError` both exit 2
 * (the invocation or the ledger is broken — distinct from exit 1, which
 * means the gate found unvouched dependencies).
 */

/** The command line itself is wrong (unknown flag, malformed spec, …). */
export class UsageError extends Error {}

/** A ledger or lockfile input is malformed or inconsistent. */
export class LedgerError extends Error {}
