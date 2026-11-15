/**
 * An interviewer's calendar, behind one interface: is this time free, hold it, let it go. Selestial's
 * own interview slots already prevent two interviews in one slot; a calendar adds the interviewer's
 * other commitments.
 *
 * Google Calendar and Microsoft 365 adapters are not built: each needs an OAuth app and stored consent
 * per interviewer (docs/recruiter/05-assumptions.md). With CALENDAR_PROVIDER unset there is no calendar
 * and a slot is reserved in Selestial alone. The mock stands in for a calendar in tests.
 */
export type CalendarEvent = { interviewerEmail: string; startsAt: number; endsAt: number; title: string; idempotencyKey: string };

export interface CalendarProvider {
  name: string;
  /** Creates the event if the time is free. `busy` means the interviewer has something else then. */
  reserve(event: CalendarEvent): Promise<{ ok: true; eventId: string } | { ok: false; busy: boolean; problem: string }>;
  release(interviewerEmail: string, eventId: string): Promise<void>;
}

/** For tests: times the mock calendar says are taken, and what it was asked to hold. */
export const mockCalendar: { busy: { interviewerEmail: string; startsAt: number; endsAt: number }[]; events: (CalendarEvent & { eventId: string })[]; released: string[] } = { busy: [], events: [], released: [] };

const mock: CalendarProvider = {
  name: "mock-calendar",
  async reserve(event) {
    const again = mockCalendar.events.find((row) => row.idempotencyKey === event.idempotencyKey);
    if (again) return { ok: true, eventId: again.eventId };
    const taken = [...mockCalendar.busy, ...mockCalendar.events].some((row) => row.interviewerEmail === event.interviewerEmail && row.startsAt < event.endsAt && event.startsAt < row.endsAt);
    if (taken) return { ok: false, busy: true, problem: "The interviewer's calendar has something else at that time." };
    const eventId = `mock-event-${mockCalendar.events.length + 1}`;
    mockCalendar.events.push({ ...event, eventId });
    return { ok: true, eventId };
  },
  async release(_email, eventId) {
    mockCalendar.released.push(eventId);
    const at = mockCalendar.events.findIndex((row) => row.eventId === eventId);
    if (at >= 0) mockCalendar.events.splice(at, 1);
  },
};

export function calendarProvider(): CalendarProvider | null {
  return process.env.CALENDAR_PROVIDER?.trim().toLowerCase() === "mock" ? mock : null;
}
