import { BookingEmbed } from "@/components/booking/embed";

export default async function Page({ params }: { params: Promise<{ handle: string; slug: string }> }) {
  const { handle, slug } = await params;
  return <BookingEmbed handle={handle.toLowerCase()} slug={slug.toLowerCase()} />;
}
