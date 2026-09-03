import type { Metadata } from "next";
import Link from "next/link";

import { MarketingShell } from "@/components/marketing/chrome";
import { APP_OWNER, CONTACT_EMAIL } from "@/lib/constants";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-2xl px-5 py-16 sm:py-24">
        <p className="text-[11px] font-semibold tracking-[0.16em] text-brand-700 uppercase">Legal</p>
        <h1 className="mt-3 font-heading text-4xl tracking-tight text-ink-950">Terms</h1>
        <p className="mt-6 text-[15px] leading-relaxed text-silver">
          Renuvo is provided by {APP_OWNER} as-is while the product is being rebuilt. Do not upload
          content you do not have the right to share. We may update these terms as features return.
          Contact{" "}
          <a className="text-brand-700 underline-offset-4 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p className="mt-8 text-sm">
          <Link href="/" className="font-medium text-brand-700 hover:underline">
            Back home
          </Link>
        </p>
      </article>
    </MarketingShell>
  );
}
