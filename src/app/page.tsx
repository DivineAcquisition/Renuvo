import { SiteFooter, SiteHeader, SkipToContent } from "@/components/marketing/chrome";
import { LandingPage } from "@/components/marketing/landing";

export default function Home() {
  return (
    <>
      <SkipToContent />
      <SiteHeader />
      <main id="content">
        <LandingPage />
      </main>
      <SiteFooter />
    </>
  );
}
