import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPortalSession, PORTAL_COOKIE } from "@/lib/portal/auth";
import { startCardUpdate } from "@/app/actions/portal-payment";
import { CardForm } from "./CardForm";

export default async function PortalPaymentPage() {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  const s = await getPortalSession(token);
  if (!s) redirect("/access-expired");

  const setup = await startCardUpdate();

  if ("error" in setup || !setup.clientSecret || !setup.stripeAccount) {
    return (
      <div className="rounded-2xl bg-white p-7 text-center shadow-sm">
        <h1 className="font-display text-xl font-bold">Card update unavailable</h1>
        <p className="mt-2 text-sm text-[#6b6880]">
          We couldn&apos;t start a secure card update right now. Please try again
          later.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <h1 className="font-display text-xl font-bold">Update your card</h1>
      <p className="mt-1 mb-4 text-sm text-[#6b6880]">
        Your card is handled securely by Stripe. We never see your full card
        number.
      </p>
      <CardForm
        clientSecret={setup.clientSecret}
        stripeAccount={setup.stripeAccount}
        publishableKey={setup.publishableKey}
      />
    </div>
  );
}
