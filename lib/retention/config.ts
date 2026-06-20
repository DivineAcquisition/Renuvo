// One place for every retention window so they're easy to audit and cite in the
// Privacy Policy. Durations in days.
export const RETENTION = {
  // message bodies are scrubbed to '[expired]' after this; metadata is kept
  messageBodyDays: 540, // ~18 months
  // A2P consent proof is retained at least this long (never pruned by sweeps)
  consentRecordDays: 365 * 4,
  // org deletion grace window (recoverable)
  orgDeletionGraceDays: 14,
} as const;
