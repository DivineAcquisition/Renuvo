/**
 * How long an invitation link works. One number, read by the record when it issues a link and by the
 * screens when they explain it, so the two can never disagree. This file has no other code in it, so
 * the browser can import it without pulling in anything from the server.
 */
export const INVITATION_DAYS = 7;
