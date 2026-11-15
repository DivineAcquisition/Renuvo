/**
 * Where the public buttons go. Both are settings, because neither exists yet.
 *
 * NEXT_PUBLIC_BOOKING_URL: the scheduling link behind "Book a call". Until it is set,
 * that button takes the visitor to the waitlist form on the page.
 * WAITLIST_WEBHOOK_URL: where a waitlist entry is sent (server only). Until it is set,
 * the form tells the visitor the waitlist is not open. It never pretends to save.
 */

export const WAITLIST_ANCHOR = "#waitlist";

export function bookingHref(): string {
  const url = process.env.NEXT_PUBLIC_BOOKING_URL?.trim();
  return url && /^https:\/\//.test(url) ? url : WAITLIST_ANCHOR;
}

export function bookingIsExternal(): boolean {
  return bookingHref() !== WAITLIST_ANCHOR;
}
