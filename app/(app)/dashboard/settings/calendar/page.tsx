import Link from "next/link";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { disconnectCalendar } from "@/app/actions/calendar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function CalendarSettings() {
  const active = await getActiveOrg();
  if (!active) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_calendar_status", {
    p_org_id: active.org.id,
  });
  const status = data?.[0] ?? { connected: false, enabled: false };

  return (
    <div className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Google Calendar (optional)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Connect a calendar to see confirmed recurring visits alongside your
            schedule. Renuvo works fully without this — it&apos;s a convenience.
          </p>
          {status.connected ? (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-primary">
                Connected ✓
              </span>
              <form action={disconnectCalendar}>
                <Button variant="ghost" size="sm">
                  Disconnect
                </Button>
              </form>
            </div>
          ) : (
            <Button asChild>
              <Link href="/api/calendar/google">Connect Google Calendar</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
