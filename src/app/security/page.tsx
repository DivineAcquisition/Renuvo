import type { Metadata } from "next";
import Link from "next/link";

import { DocumentView } from "@/components/trust/document";
import { PublicPage } from "@/components/trust/public-page";
import { ShieldCheck } from "@/components/icons";
import { textFor } from "@/lib/trust/documents";
import { formatDay, loadPublicTrust } from "@/lib/trust/public";

import { currentVersion } from "../../../convex/lib/trust/documents";

export const metadata: Metadata = { title: "Security", description: textFor("security").lead, alternates: { canonical: "/security" } };
export const revalidate = 300;

/**
 * The public security overview. The "What we can show today" list is the verified, public claims
 * from the trust records: nothing appears there that staff have not marked verified with evidence.
 */
export default async function Page() {
  const trust = await loadPublicTrust();
  const version = currentVersion("security");
  const published = trust.publications.some((row) => row.documentId === version.id && row.status === "published");
  const extra = (
    <div className="mt-10 grid gap-6">
      {trust.claims.length > 0 ? (
        <section aria-labelledby="verified" className="rounded-2xl border border-[#e4e7ef] bg-white p-5 sm:p-6">
          <h2 id="verified" className="flex items-center gap-2 text-base font-semibold text-[#211a35]">
            <ShieldCheck className="size-5 text-[#5126c7]" aria-hidden />
            What we can show today
          </h2>
          <p className="mt-1 text-sm text-[#667085]">Each statement is backed by code and tests we have checked. We list only what has been verified.</p>
          <ul className="mt-4 grid gap-3">
            {trust.claims.map((claim) => (
              <li key={claim.key} className="rounded-xl border border-[#e4e7ef] bg-[#f8f9fc] px-4 py-3">
                <p className="text-sm leading-relaxed text-[#211a35]">{claim.text}</p>
                <p className="mt-1 text-xs text-[#667085]">Last checked {formatDay(claim.reviewedOn)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <nav aria-label="Security pages" className="grid gap-3 sm:grid-cols-3">
        {[
          { href: "/security/subprocessors", title: "Subprocessors", body: "The providers that handle data for Selestial." },
          { href: "/security/report", title: "Report a vulnerability", body: "Tell us about a security problem you found." },
          { href: "/security/review", title: "Request a security review", body: "Send us your questionnaire or questions." },
        ].map((link) => (
          <Link key={link.href} href={link.href} className="rounded-2xl border border-[#e4e7ef] bg-white p-4 transition-colors hover:border-[#b39eff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef]">
            <span className="block font-semibold text-[#211a35]">{link.title}</span>
            <span className="mt-1 block text-sm text-[#667085]">{link.body}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
  return (
    <PublicPage trust={trust}>
      <DocumentView text={textFor("security")} version={version} history={[version]} available={published} contact={trust.settings.contacts.security} extra={extra} />
    </PublicPage>
  );
}
