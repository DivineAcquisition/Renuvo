import type { Metadata } from "next";
import { resolveSignupToken } from "@/lib/capture/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { EnrollForm } from "./EnrollForm";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function CapturePage({
  params,
}: {
  params: { token: string };
}) {
  const { token } = params;
  const offer = await resolveSignupToken(token);

  if (!offer) {
    return (
      <main className="wash-capture flex min-h-screen items-center justify-center p-6">
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

  const admin = createAdminClient();
  const [{ data: cadencesRaw }, { data: offerCfg }] = await Promise.all([
    admin
      .from("cadence_profiles")
      .select("id, label, interval_days, key")
      .eq("vertical_id", offer.verticalId ?? "")
      .order("interval_days"),
    admin
      .from("offer_configs")
      .select("offered_cadences")
      .eq("organization_id", offer.orgId ?? "")
      .maybeSingle(),
  ]);

  // restrict to the org's offered cadences (Prompt 33), always keeping the one
  // the offer link was created with so the link stays valid.
  const offered = (offerCfg?.offered_cadences as string[] | undefined) ?? null;
  const cadences = (cadencesRaw ?? []).filter(
    (c: { id: string; key?: string | null }) =>
      !offered ||
      c.id === offer.cadenceProfileId ||
      (c.key != null && offered.includes(c.key))
  );

  return (
    <main className="wash-capture flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[460px]">
        <EnrollForm
          token={token}
          businessName={offer.businessName}
          firstName={offer.firstName}
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
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          powered by{" "}
          <span className="font-display font-semibold">Renuvo</span>
        </p>
      </div>
    </main>
  );
}
