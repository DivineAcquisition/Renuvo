import { redirect } from "next/navigation";

/** Customers & Properties became Clients & Properties on November 18, 2026. Old links keep their search. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  const query = params.toString();
  redirect(`/app/clients${query ? `?${query}` : ""}`);
}
