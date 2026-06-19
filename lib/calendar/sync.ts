import { google } from "googleapis";
import { authorizedClientForOrg } from "./google";
import { createAdminClient } from "@/lib/supabase/admin";

export type VisitEvent = {
  jobId: string;
  title: string;
  startISO: string;
  durationMin?: number;
  location?: string;
  notes?: string;
};

/**
 * Write recurring visits to the org's calendar. ALWAYS safe to call:
 * if calendar isn't connected/enabled or the API errors, it logs and returns
 * { written: 0 } — it NEVER throws into the conversion/booking flow.
 */
export async function writeVisitsToCalendar(
  orgId: string,
  visits: VisitEvent[]
) {
  try {
    const auth = await authorizedClientForOrg(orgId);
    if (!auth) return { written: 0, skipped: "not_connected" as const };

    const admin = createAdminClient();
    const { data: conn } = await admin
      .from("calendar_connections")
      .select("calendar_id")
      .eq("organization_id", orgId)
      .single();

    const cal = google.calendar({ version: "v3", auth });
    let written = 0;

    for (const v of visits) {
      const start = new Date(v.startISO);
      const end = new Date(start.getTime() + (v.durationMin ?? 120) * 60_000);
      await cal.events.insert({
        calendarId: conn?.calendar_id ?? "primary",
        requestBody: {
          summary: v.title,
          description: v.notes,
          location: v.location,
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
          extendedProperties: { private: { renuvo_job_id: v.jobId } },
        },
      });
      written++;
    }
    return { written };
  } catch (e) {
    console.error("[calendar] write failed (non-blocking):", e);
    return { written: 0, skipped: "error" as const };
  }
}
