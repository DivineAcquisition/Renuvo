import type { Metadata } from "next";

import { StartDraft } from "@/components/app/sales/start-draft";

export const metadata: Metadata = { title: "New booking" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  return <StartDraft mode={one("mode") === "proposal" ? "proposal" : "booking"} segment={one("segment")} kind={one("kind")} customerId={one("customer")} propertyId={one("property")} opportunityId={one("opportunity")} jobId={one("job")} from={one("from")} />;
}
