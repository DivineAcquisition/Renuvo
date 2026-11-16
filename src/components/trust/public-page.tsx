import { Suspense } from "react";

import { ConsentControls } from "@/components/consent/banner";
import { Trackers } from "@/components/consent/trackers";
import { SiteFooter, SiteHeader, SkipToContent } from "@/components/marketing/chrome";
import { trackingTools } from "@/lib/consent/tools";
import type { PublicTrust } from "@/lib/trust/public";

/** The operator line for the footer, only when both name and address are verified. */
export function footerEntity(trust: PublicTrust) {
  return trust.settings.legalEntity ? { name: trust.settings.legalEntity, address: trust.settings.mailingAddress } : null;
}

/**
 * Every public page: header, content, footer with the trust and legal links, and the cookie controls.
 * The optional tools are listed here but load only after a choice allows them (src/lib/consent).
 */
export function PublicPage({ trust, onHome = false, children }: { trust: PublicTrust; onHome?: boolean; children: React.ReactNode }) {
  const tools = trackingTools();
  return (
    <>
      <SkipToContent />
      <SiteHeader onHome={onHome} />
      <main id="content">{children}</main>
      <SiteFooter entity={footerEntity(trust)} />
      <ConsentControls tools={tools} />
      <Suspense fallback={null}>
        <Trackers tools={tools} />
      </Suspense>
    </>
  );
}
