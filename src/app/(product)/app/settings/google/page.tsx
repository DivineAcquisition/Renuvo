import { redirect } from "next/navigation";

/**
 * Google is set up inside Settings › Integrations now (the owner's decision of November 16, 2026). This
 * address stays so old links, and Google's sign-in return from before the move, still land there.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const { result } = await searchParams;
  redirect(`/app/settings/integrations?google=1${result ? `&result=${encodeURIComponent(result)}` : ""}#google`);
}
