import type { Metadata } from "next";

import { PublicPage } from "@/components/trust/public-page";
import { formatDay, loadPublicTrust } from "@/lib/trust/public";

export const metadata: Metadata = { title: "Subprocessors", description: "The providers that process data for Selestial, what each one handles, and why.", alternates: { canonical: "/security/subprocessors" } };
export const revalidate = 300;

const STATUS: Record<string, string> = { in_use: "In use", connected_not_live: "Set up, not live yet" };

/** The providers that handle data for Selestial, from the trust records. Unverified details say so. */
export default async function Page() {
  const trust = await loadPublicTrust();
  const rows = trust.providers;
  const reviewed = rows.map((row) => row.reviewedOn).filter(Boolean).sort().at(-1);
  return (
    <PublicPage trust={trust}>
      <div className="px-5 pt-10 pb-20 sm:px-6 sm:pt-14 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold tracking-[0.16em] text-[#5126c7] uppercase">Trust</p>
          <h1 className="mt-3 font-heading text-4xl tracking-tight text-[#211a35] sm:text-5xl">Subprocessors</h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[#3d3654]">The providers Selestial uses to run the service, what each one handles, and why. Where a detail has not been verified yet, it says so.</p>
          {reviewed ? <p className="mt-3 text-sm text-[#667085]">Last reviewed {formatDay(reviewed)}</p> : null}
          <div className="mt-10 overflow-x-auto rounded-2xl border border-[#e4e7ef] bg-white">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">Providers that process data for Selestial</caption>
              <thead className="bg-[#f8f9fc] text-[#211a35]">
                <tr>
                  {["Provider", "What it does for us", "Data it handles", "Where", "Status"].map((cell) => (
                    <th key={cell} scope="col" className="px-4 py-3 font-semibold">
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-[#e4e7ef] align-top">
                    <th scope="row" className="px-4 py-3 font-semibold text-[#211a35]">
                      {row.policyUrl ? (
                        <a href={row.policyUrl} className="underline-offset-4 hover:underline" rel="noreferrer noopener" target="_blank">
                          {row.name}
                        </a>
                      ) : (
                        row.name
                      )}
                    </th>
                    <td className="px-4 py-3 text-[#3d3654]">{row.purpose}</td>
                    <td className="px-4 py-3 text-[#3d3654]">{row.dataHandled}</td>
                    <td className="px-4 py-3 text-[#667085]">{row.locations ?? "Not yet verified"}</td>
                    <td className="px-4 py-3">
                      <span className={row.status === "in_use" ? "font-medium text-[#211a35]" : "text-[#667085]"}>{STATUS[row.status] ?? row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-[#667085]">
            Optional site analytics and advertising tools are covered on <a href="/cookies" className="font-medium text-[#5126c7] underline underline-offset-4">Cookies and tracking</a>. They run only if you allow them, and never inside the Selestial app.
          </p>
        </div>
      </div>
    </PublicPage>
  );
}
