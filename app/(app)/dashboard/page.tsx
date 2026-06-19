import { getActiveOrg } from "@/lib/auth/getActiveOrg";

export default async function DashboardHome() {
  const active = await getActiveOrg();
  return (
    <div>
      <h1 className="font-display text-2xl font-bold">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Signed in to {active?.org.name} as {active?.role}. Metrics arrive in
        Prompt 21.
      </p>
    </div>
  );
}
