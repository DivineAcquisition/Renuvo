import { Fragment } from "react";

/**
 * A company's own texting page, plainly set: its name and logo, then its words. "## " starts a heading,
 * a blank line starts a paragraph, and web addresses become links. Nothing here is Selestial's: the page
 * belongs to the business that published it.
 */
const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

export function Linked({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, i) =>
        URL_PATTERN.test(part) ? (
          <a key={i} href={part.replace(/[.,)]+$/, "")} className="font-medium text-zinc-900 underline underline-offset-2">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function PageFrame({ company, children }: { company: { name: string; logoUrl: string | null; brandColor: string }; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-10 text-zinc-800 sm:py-14">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 flex items-center gap-3">
          {company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt="" className="size-10 rounded-lg object-contain" />
          ) : (
            <span aria-hidden className="grid size-10 place-items-center rounded-lg text-base font-semibold text-white" style={{ backgroundColor: company.brandColor }}>
              {company.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <p className="text-base font-semibold text-zinc-900">{company.name}</p>
        </header>
        <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">{children}</article>
      </div>
    </main>
  );
}

export function LegalBody({ body, publishedAt }: { body: string; publishedAt: number }) {
  const blocks = body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  let first = true;
  return (
    <div className="space-y-4 text-[15px] leading-7">
      {blocks.map((block, i) => {
        if (block.startsWith("## ")) {
          const heading = block.slice(3);
          if (first) {
            first = false;
            return (
              <h1 key={i} className="text-2xl font-semibold tracking-tight text-zinc-900">
                {heading}
              </h1>
            );
          }
          return (
            <h2 key={i} className="pt-2 text-base font-semibold text-zinc-900">
              {heading}
            </h2>
          );
        }
        return (
          <p key={i}>
            <Linked text={block} />
          </p>
        );
      })}
      <p className="pt-4 text-xs text-zinc-500">Last updated {new Date(publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}.</p>
    </div>
  );
}

export function Missing() {
  return (
    <main className="grid min-h-screen place-items-center bg-white px-4 text-center">
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">This page isn&apos;t available</h1>
        <p className="text-sm text-zinc-600">Check the address, or contact the business directly.</p>
      </div>
    </main>
  );
}
