import { CookiePreferencesLink } from "@/components/consent/banner";
import { DocumentPage, documentMetadata } from "@/components/trust/document-page";
import { trackingTools } from "@/lib/consent/tools";

export const metadata = documentMetadata("cookies", "/cookies");
export const revalidate = 300;

/** The cookies notice, with the tools as they are set up on this site right now and the way to change a choice. */
export default function Page() {
  const tools = trackingTools();
  const extra = (
    <div className="mt-8 rounded-2xl border border-[#e4e7ef] bg-white p-5">
      <h2 className="text-base font-semibold text-[#211a35]">On this site right now</h2>
      <ul className="mt-3 grid gap-2 text-sm">
        {tools.map((tool) => (
          <li key={tool.key} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[#211a35]">
              {tool.name} <span className="text-[#667085]">· {tool.category === "analytics" ? "Analytics" : "Advertising"}</span>
            </span>
            <span className={tool.id ? "font-medium text-[#5126c7]" : "text-[#667085]"}>{tool.id ? "In use, only if you allow it" : "Not in use"}</span>
          </li>
        ))}
      </ul>
      <CookiePreferencesLink className="icon-gradient mt-4 inline-flex h-11 items-center justify-center rounded-xl border border-[#5126c7]/40 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6838ef]" />
    </div>
  );
  return <DocumentPage kind="cookies" extra={extra} />;
}
