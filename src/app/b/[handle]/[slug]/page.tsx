import { LiveBooking } from "@/components/booking/live";

export default async function Page({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params;
  return <LiveBooking handle={handle.toLowerCase()} slug={slug.toLowerCase()} />;
}
