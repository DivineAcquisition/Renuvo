import { render } from "@react-email/render";
import { Welcome, VerifyEmail, ResetPassword } from "@/emails/auth";
import { Invitation } from "@/emails/team";
import { SubscriptionReceipt, PaymentFailed, TrialEnding } from "@/emails/billing";
import { LowBalance, ReloadReceipt } from "@/emails/wallet";
import { BrandVerified, CampaignApproved, RegistrationActionNeeded } from "@/emails/a2p";
import { EventAlert, WeeklyDigest } from "@/emails/notify";
import { DeletionScheduled } from "@/emails/account";
import {
  EnrollmentConfirmation,
  RecurringReceipt,
  VisitReminder,
  CardExpiring,
  PortalMagicLink,
  WinBack,
  UnsubscribeConfirmation,
} from "@/emails/customer";

export const dynamic = "force-dynamic";

const brand = { name: "Novara Cleaning", accent: "#4F38FF" };
const cFooter = {
  address: "Novara Cleaning · 123 Main St, Austin, TX 78701",
  unsubscribeUrl: "https://account.renuvo.io/u/x",
};

// every template with sample props — design QA without sending
const CATALOG: { section: string; label: string; el: React.ReactElement }[] = [
  { section: "Auth", label: "Welcome", el: <Welcome name="Alex" onboardingUrl="#" /> },
  { section: "Auth", label: "Verify email", el: <VerifyEmail name="Alex" verifyUrl="#" /> },
  { section: "Auth", label: "Reset password", el: <ResetPassword name="Alex" resetUrl="#" /> },
  { section: "Team", label: "Invitation", el: <Invitation inviter="Sam" orgName="Novara" acceptUrl="#" /> },
  { section: "Billing", label: "Subscription receipt", el: <SubscriptionReceipt orgName="Novara" plan="Pro" amount="$197.00" periodEnd="Jul 20" manageUrl="#" /> },
  { section: "Billing", label: "Payment failed", el: <PaymentFailed orgName="Novara" updateUrl="#" retryDate="Jun 24" /> },
  { section: "Billing", label: "Trial ending", el: <TrialEnding orgName="Novara" daysLeft={3} addCardUrl="#" /> },
  { section: "Wallet", label: "Low balance", el: <LowBalance orgName="Novara" balance="$3.40" addFundsUrl="#" /> },
  { section: "Wallet", label: "Reload receipt", el: <ReloadReceipt orgName="Novara" amount="$25.00" newBalance="$28.40" /> },
  { section: "A2P", label: "Brand verified", el: <BrandVerified orgName="Novara" nextUrl="#" /> },
  { section: "A2P", label: "Campaign approved", el: <CampaignApproved orgName="Novara" dashboardUrl="#" /> },
  { section: "A2P", label: "Action needed", el: <RegistrationActionNeeded orgName="Novara" reason="EIN mismatch" fixUrl="#" /> },
  { section: "Notify", label: "Event alert", el: <EventAlert title="New recurring conversion 🎉" body="A customer started recurring service." ctaUrl="#" prefsUrl="#" /> },
  { section: "Notify", label: "Weekly digest", el: <WeeklyDigest orgName="Novara" mrr="$4,200" conversions={6} atRisk={2} dashboardUrl="#" /> },
  { section: "Account", label: "Deletion scheduled", el: <DeletionScheduled orgName="Novara" scheduledDate="Jul 5" cancelUrl="#" /> },
  { section: "Customer", label: "Enrollment confirmation", el: <EnrollmentConfirmation brand={brand} firstName="Jordan" cadenceLabel="Every 2 weeks" price="$150" manageUrl="#" footer={cFooter} /> },
  { section: "Customer", label: "Recurring receipt", el: <RecurringReceipt brand={brand} firstName="Jordan" amount="$150" date="Jun 20" nextVisit="Jul 4" footer={cFooter} /> },
  { section: "Customer", label: "Visit reminder", el: <VisitReminder brand={brand} firstName="Jordan" visitDate="Friday" manageUrl="#" footer={cFooter} /> },
  { section: "Customer", label: "Card expiring", el: <CardExpiring brand={brand} firstName="Jordan" updateUrl="#" footer={cFooter} /> },
  { section: "Customer", label: "Portal magic link", el: <PortalMagicLink brand={brand} firstName="Jordan" accessUrl="#" footer={cFooter} /> },
  { section: "Customer", label: "Win-back", el: <WinBack brand={brand} firstName="Jordan" discountLabel="20% off" captureUrl="#" footer={cFooter} /> },
  { section: "Customer", label: "Unsubscribe confirmation", el: <UnsubscribeConfirmation brand={brand} footer={cFooter} /> },
];

export default async function EmailPreviewPage() {
  const rendered = await Promise.all(
    CATALOG.map(async (t) => ({
      ...t,
      html: await render(t.el),
    }))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Email preview</h1>
        <p className="text-sm text-white/60">
          Every template with sample props — design QA without sending. Renders
          the same React Email components the app sends.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {rendered.map((t) => (
          <div
            key={`${t.section}-${t.label}`}
            className="overflow-hidden rounded-xl border border-white/10 bg-white/5"
          >
            <div className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="font-medium">{t.label}</span>
              <span className="text-xs uppercase tracking-wide text-white/40">
                {t.section}
              </span>
            </div>
            <iframe
              title={t.label}
              srcDoc={t.html}
              className="h-[440px] w-full border-0 bg-white"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
