import type { Metadata } from "next";
import { resolveSignupToken } from "@/lib/capture/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { EnrollForm } from "./EnrollForm";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export default async function CapturePage({
  params,
}: {
  params: { token: string };
}) {
  const { token } = params;
  const offer = await resolveSignupToken(token);

  if (!offer) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="font-display text-xl font-bold">
            This link has expired
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Reach out to your provider and they&apos;ll send you a fresh one.
          </p>
        </div>
      </main>
    );
  }

  // cadence options for this vertical
  const admin = createAdminClient();
  const { data: cadences } = await admin
    .from("cadence_profiles")
    .select("id, label, interval_days")
    .eq("vertical_id", offer.verticalId ?? "")
    .order("interval_days");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <p className="text-sm text-muted-foreground">{offer.businessName}</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">
          Hi {offer.firstName} — keep your service going automatically
        </h1>
        <p className="mt-2 text-muted-foreground">
          Lock in {money(offer.priceCents, offer.currency)} per visit, billed
          automatically. No rebooking, cancel anytime.
        </p>

        <EnrollForm
          token={token}
          priceCents={offer.priceCents}
          currency={offer.currency}
          cadences={(cadences ?? []).map(
            (c: { id: string; label: string }) => ({
              id: c.id,
              label: c.label,
            })
          )}
          defaultCadenceId={offer.cadenceProfileId}
        />
      </div>
    </main>
  );
}
