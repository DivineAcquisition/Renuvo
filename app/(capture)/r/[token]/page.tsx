import type { Metadata } from "next";
import { resolveSignupToken } from "@/lib/capture/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgSettings } from "@/lib/settings/resolve";
import { getActiveMenu } from "@/lib/packages/compose";
import { EnrollForm } from "./EnrollForm";
import { GenericLeadForm } from "./GenericLeadForm";

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
  const { data: cadencesRaw } = await admin
    .from("cadence_profiles")
    .select("id, label, interval_days, key")
    .eq("vertical_id", offer.verticalId ?? "")
    .order("interval_days");

  // restrict to the org's offered cadences via the settings resolver (Prompt 35),
  // always keeping the one the offer link was created with so the link stays valid.
  const settings = await getOrgSettings(offer.orgId);
  const offered = settings.offeredCadences;
  const cadences = (cadencesRaw ?? []).filter(
    (c: { id: string; key?: string | null }) =>
      !offered ||
      c.id === offer.cadenceProfileId ||
      (c.key != null && offered.includes(c.key))
  );

  // the business's service menu (packages + add-ons). Empty → legacy single price.
  const menu = await getActiveMenu(offer.orgId);

  const isGeneric = offer.linkType === "generic" || !offer.customerId;

  return (
    <main className="wash-capture flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[460px]">
        {isGeneric ? (
          <div className="glass rounded-2xl p-7">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {offer.businessName}
            </p>
            <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">
              Set up recurring service
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Tell us who you are to get started.
            </p>
            <GenericLeadForm token={token} />
          </div>
        ) : (
          <EnrollForm
            token={token}
            businessName={offer.businessName}
            firstName={offer.firstName}
            priceCents={offer.priceCents}
            currency={offer.currency}
            cadences={(cadences ?? []).map(
              (c: { id: string; label: string; key?: string | null }) => ({
                id: c.id,
                label: c.label,
                key: c.key,
              })
            )}
            defaultCadenceId={offer.cadenceProfileId ?? ""}
            packages={menu.packages.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              basePriceCents: p.base_price_cents,
              defaultCadenceKey: p.default_cadence_key,
              discountPct: p.recurring_discount_pct,
            }))}
            addons={menu.addons.map((a) => ({
              id: a.id,
              name: a.name,
              priceCents: a.price_cents,
            }))}
            orgDiscountPct={menu.orgDiscountPct}
          />
        )}
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          powered by{" "}
          <span className="font-display font-semibold">Renuvo</span>
        </p>
      </div>
    </main>
  );
}
