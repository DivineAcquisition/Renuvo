import type { Metadata } from "next";

import { Missing, PageFrame } from "@/components/texting/legal-page";
import { SignupForm } from "@/components/texting/signup-form";
import { loadTextingPage } from "@/lib/texting/public";

type Props = { params: Promise<{ handle: string }>; searchParams: Promise<{ embed?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadTextingPage((await params).handle.toLowerCase(), "signup");
  return { title: page ? `Texts from ${page.company.name}` : "Texts" };
}

/** A company's texting sign-up, published from Set up business texting. `?embed=1` drops the frame for a company's own website. */
export default async function Page({ params, searchParams }: Props) {
  const handle = (await params).handle.toLowerCase();
  const page = await loadTextingPage(handle, "signup");
  if (!page) return <Missing />;
  const form = <SignupForm handle={handle} version={page.version} company={page.company.name} consent={page.body} marketing={page.marketing} links={page.links} />;
  if ((await searchParams).embed === "1") return <div className="bg-white p-4">{form}</div>;
  return (
    <PageFrame company={page.company}>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Texts from {page.company.name}</h1>
      <p className="mt-2 text-[15px] leading-7 text-zinc-600">Get texts about your requests, bookings and visits. Choose what you&apos;d like below.</p>
      <div className="mt-6">{form}</div>
    </PageFrame>
  );
}
