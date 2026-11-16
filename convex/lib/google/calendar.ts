/**
 * Google Calendar. Selestial's events get deterministic ids, so creating the same visit twice finds the
 * first event instead of making a second, and a sync after an uncertain answer can look the event up.
 * Busy times come from freeBusy, which expands recurring events and applies the calendar's own time zone.
 */
import { sha256 } from "../agreements/hash";
import { GoogleError, googleCall, type Fetch } from "./http";

const API = "https://www.googleapis.com/calendar/v3";

export type CalendarEntry = { id: string; summary: string; timeZone?: string; accessRole?: string; primary?: boolean };
export type CalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
  recurringEventId?: string;
};

export async function listCalendars(token: string, fetcher?: Fetch): Promise<CalendarEntry[]> {
  const body = await googleCall<{ items?: CalendarEntry[] }>(`${API}/users/me/calendarList?minAccessRole=reader&maxResults=250`, token, { fetcher });
  return body.items ?? [];
}

export async function getCalendar(token: string, calendarId: string, fetcher?: Fetch): Promise<CalendarEntry> {
  return googleCall<CalendarEntry>(`${API}/users/me/calendarList/${encodeURIComponent(calendarId)}`, token, { fetcher });
}

export type Busy = { start: number; end: number };

export async function freeBusy(token: string, input: { calendarIds: string[]; from: number; to: number; timeZone: string }, fetcher?: Fetch): Promise<{ busy: Record<string, Busy[]>; errors: Record<string, string> }> {
  const body = await googleCall<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }> }>(`${API}/freeBusy`, token, {
    method: "POST",
    body: { timeMin: new Date(input.from).toISOString(), timeMax: new Date(input.to).toISOString(), timeZone: input.timeZone, items: input.calendarIds.map((id) => ({ id })) },
    fetcher,
  });
  const busy: Record<string, Busy[]> = {};
  const errors: Record<string, string> = {};
  for (const [id, entry] of Object.entries(body.calendars ?? {})) {
    if (entry.errors?.length) errors[id] = entry.errors.map((e) => e.reason ?? "error").join(", ");
    busy[id] = (entry.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
  }
  return { busy, errors };
}

/** A Calendar event id for one Selestial record in one calendar: base32hex characters, stable, unique. */
export function eventIdFor(companyId: string, calendarId: string, subjectId: string): string {
  return `sel${sha256(`${companyId}|${calendarId}|${subjectId}`).slice(0, 40)}`;
}

export type EventDraft = { id: string; summary: string; description: string; location?: string; startsAt: number; endsAt: number; timeZone: string; subjectId: string };

function toBody(draft: EventDraft) {
  return {
    id: draft.id,
    summary: draft.summary.slice(0, 300),
    description: draft.description.slice(0, 4000),
    ...(draft.location ? { location: draft.location.slice(0, 500) } : {}),
    start: { dateTime: new Date(draft.startsAt).toISOString(), timeZone: draft.timeZone },
    end: { dateTime: new Date(draft.endsAt).toISOString(), timeZone: draft.timeZone },
    extendedProperties: { private: { selestial: "1", subject: draft.subjectId } },
    reminders: { useDefault: true },
  };
}

/** What Selestial writes, as a hash, so an unchanged visit is not sent again. */
export function draftHash(draft: EventDraft): string {
  return sha256(JSON.stringify(toBody(draft)));
}

/**
 * Creates or updates the event. Insert first; if Google says it already exists (the id is ours), update
 * it. A deleted event with our id cannot be re-inserted, so it is restored by update.
 */
export async function upsertEvent(token: string, calendarId: string, draft: EventDraft, fetcher?: Fetch): Promise<CalendarEvent> {
  const base = `${API}/calendars/${encodeURIComponent(calendarId)}/events`;
  try {
    return await googleCall<CalendarEvent>(`${base}?sendUpdates=none`, token, { method: "POST", body: toBody(draft), fetcher });
  } catch (error) {
    if (!(error instanceof GoogleError) || (error.kind !== "conflict" && error.kind !== "uncertain")) throw error;
    return googleCall<CalendarEvent>(`${base}/${encodeURIComponent(draft.id)}?sendUpdates=none`, token, { method: "PUT", body: { ...toBody(draft), status: "confirmed" }, fetcher });
  }
}

export async function getEvent(token: string, calendarId: string, eventId: string, fetcher?: Fetch): Promise<CalendarEvent | null> {
  try {
    return await googleCall<CalendarEvent>(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, token, { fetcher });
  } catch (error) {
    if (error instanceof GoogleError && error.kind === "not_found") return null;
    throw error;
  }
}

/** Removes Selestial's event. Already gone is fine. */
export async function deleteEvent(token: string, calendarId: string, eventId: string, fetcher?: Fetch): Promise<void> {
  try {
    await googleCall(`${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, token, { method: "DELETE", fetcher });
  } catch (error) {
    if (error instanceof GoogleError && (error.kind === "not_found" || error.status === 410)) return;
    throw error;
  }
}

/** Changed events since the last sync. A sync token Google no longer accepts (410) means a full resync. */
export async function changes(token: string, calendarId: string, syncToken: string | undefined, fetcher?: Fetch): Promise<{ events: CalendarEvent[]; nextSyncToken: string | null; resync: boolean }> {
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ maxResults: "250", showDeleted: "true", singleEvents: "false" });
    if (syncToken) params.set("syncToken", syncToken);
    else params.set("timeMin", new Date(Date.now() - 7 * 86_400_000).toISOString());
    if (pageToken) params.set("pageToken", pageToken);
    try {
      const body = await googleCall<{ items?: CalendarEvent[]; nextPageToken?: string; nextSyncToken?: string }>(`${API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, token, { fetcher });
      events.push(...(body.items ?? []));
      if (body.nextPageToken) {
        pageToken = body.nextPageToken;
        continue;
      }
      return { events, nextSyncToken: body.nextSyncToken ?? null, resync: false };
    } catch (error) {
      if (error instanceof GoogleError && error.status === 410) return { events: [], nextSyncToken: null, resync: true };
      throw error;
    }
  }
  return { events, nextSyncToken: null, resync: false };
}

export async function watch(token: string, calendarId: string, input: { channelId: string; address: string; token: string; ttlSeconds: number }, fetcher?: Fetch): Promise<{ resourceId: string; expiration: number }> {
  const body = await googleCall<{ resourceId?: string; expiration?: string }>(`${API}/calendars/${encodeURIComponent(calendarId)}/events/watch`, token, {
    method: "POST",
    body: { id: input.channelId, type: "web_hook", address: input.address, token: input.token, params: { ttl: String(input.ttlSeconds) } },
    fetcher,
  });
  if (!body.resourceId) throw new GoogleError("invalid", "Google did not open the notification channel.");
  return { resourceId: body.resourceId, expiration: Number(body.expiration ?? Date.now() + input.ttlSeconds * 1000) };
}

export async function stopChannel(token: string, channelId: string, resourceId: string, fetcher?: Fetch): Promise<void> {
  try {
    await googleCall(`${API}/channels/stop`, token, { method: "POST", body: { id: channelId, resourceId }, fetcher });
  } catch (error) {
    if (!(error instanceof GoogleError) || error.kind !== "not_found") throw error;
  }
}

/** Overlaps between proposed spans and busy times, for conflict checks. */
export function conflicts(spans: { startsAt: number; endsAt: number }[], busy: Busy[]): { startsAt: number; endsAt: number }[] {
  return spans.filter((s) => busy.some((b) => s.startsAt < b.end && b.start < s.endsAt));
}
