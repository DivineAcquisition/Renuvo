import { OfferPage } from "@/components/cleaner/offer-page";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OfferPage token={token} />;
}
