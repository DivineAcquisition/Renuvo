import { cn } from "@/lib/utils";

/** The customer's copy of a proposal version: what the workspace preview, the client's page and print all show. */
export type ProposalDoc = {
  template: "commercial" | "office" | "str";
  title: string;
  intro: string;
  client: { name: string; email: string | null };
  sites: {
    key: string;
    label: string;
    address: string | null;
    service: { name: string; version: number } | null;
    scope: string[];
    excluded: string[];
    details: { label: string; value: string }[];
    matrix: { task: string; frequency: string; note: string | null }[];
    cadence: string | null;
    cadenceRate: string | null;
    perTurnover: boolean;
    priceCents: number | null;
    initialCharge: { label: string; cents: number } | null;
    monthlyEstimateCents: number | null;
    monthlyVisits: number | null;
  }[];
  options: { id: string; label: string; description: string | null; sites: { key: string; serviceName: string | null; priceCents: number | null }[] }[];
  terms: { invoiceFrequency: string; netDays: number | null; contractTerm: string; startPlan: string | null; startTogether: boolean; rushTerms: string | null; restockPolicy: string | null };
  totals: { initialCents: number; fixedMonthlyEstimateCents: number | null; anyVariable: boolean };
  attachments: { label: string; url: string }[];
};

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export function ProposalDocument({ doc, company, version, expiresAt, selectedOption, onSelectOption }: { doc: ProposalDoc; company: string; version: number | null; expiresAt: number | null; selectedOption?: string; onSelectOption?: (id: string) => void }) {
  return (
    <article className="flex flex-col gap-5 text-sm text-foreground">
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 via-brand-500 to-[#8b6cff] p-5 text-white print:bg-none print:p-0 print:text-black">
        <p className="text-xs font-semibold tracking-wide uppercase opacity-90">
          {company} · Proposal{version ? ` v${version}` : ""}
          {expiresAt ? ` · open until ${new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}` : ""}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">For {doc.client.name}</h1>
        <p className="mt-2 max-w-prose opacity-95">{doc.intro}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs opacity-80">{doc.sites.length === 1 ? "Site" : "Sites"}</dt>
            <dd className="text-lg font-semibold">{doc.sites.length}</dd>
          </div>
          {doc.totals.fixedMonthlyEstimateCents !== null ? (
            <div>
              <dt className="text-xs opacity-80">Estimated monthly{doc.totals.anyVariable ? " (scheduled sites)" : ""}</dt>
              <dd className="text-lg font-semibold">{usd(doc.totals.fixedMonthlyEstimateCents)}</dd>
            </div>
          ) : null}
          {doc.totals.initialCents ? (
            <div>
              <dt className="text-xs opacity-80">One-time setup</dt>
              <dd className="text-lg font-semibold">{usd(doc.totals.initialCents)}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      <section aria-labelledby="sites-h" className="flex flex-col gap-3">
        <h2 id="sites-h" className="text-base font-semibold">
          Recommended plan
        </h2>
        {doc.sites.map((site) => (
          <div key={site.key} className="rounded-2xl border border-border bg-card p-4 break-inside-avoid">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{site.label}</p>
                {site.address ? <p className="text-xs text-muted-foreground">{site.address}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {[site.service?.name, site.cadence].filter(Boolean).join(" · ")}
                  {site.cadenceRate ? ` (${site.cadenceRate})` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold tabular-nums">{site.priceCents !== null ? usd(site.priceCents) : "To be confirmed"}</p>
                <p className="text-xs text-muted-foreground">per {site.perTurnover ? "turnover" : "visit"}</p>
              </div>
            </div>
            {site.monthlyEstimateCents !== null && site.monthlyVisits !== null ? (
              <p className="mt-2 text-xs text-muted-foreground">
                About {usd(site.monthlyEstimateCents)} a month on average ({site.monthlyVisits} visits a month averaged over a year). Each month is invoiced for the visits actually done.
              </p>
            ) : null}
            {site.perTurnover ? <p className="mt-2 text-xs text-muted-foreground">Each turnover is scheduled from a real stay and confirmed when a crew is available. There is no fixed monthly amount.</p> : null}
            {site.initialCharge ? (
              <p className="mt-2 text-xs">
                <span className="font-medium">{site.initialCharge.label}:</span> {usd(site.initialCharge.cents)}, once.
              </p>
            ) : null}
            {site.details.length ? (
              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                {site.details.map((d) => (
                  <div key={d.label} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{d.label}</dt>
                    <dd className="text-right">{d.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {site.matrix.length ? (
              <table className="mt-3 w-full text-xs">
                <caption className="sr-only">Tasks and how often</caption>
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-medium">Task</th>
                    <th className="py-1 font-medium">How often</th>
                  </tr>
                </thead>
                <tbody>
                  {site.matrix.map((row) => (
                    <tr key={row.task} className="border-t border-border">
                      <td className="py-1">
                        {row.task}
                        {row.note ? <span className="text-muted-foreground"> · {row.note}</span> : null}
                      </td>
                      <td className="py-1">{row.frequency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {site.scope.length ? (
              <details className="mt-3 text-xs" open>
                <summary className="cursor-pointer font-medium">What&apos;s included</summary>
                <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
                  {site.scope.map((item) => (
                    <li key={item}>✓ {item}</li>
                  ))}
                </ul>
                {site.excluded.length ? <p className="mt-1 text-muted-foreground">Not included: {site.excluded.join(", ")}.</p> : null}
              </details>
            ) : null}
          </div>
        ))}
      </section>

      {doc.options.length ? (
        <section aria-labelledby="options-h" className="flex flex-col gap-2">
          <h2 id="options-h" className="text-base font-semibold">
            Other options
          </h2>
          {onSelectOption ? (
            <label className={cn("flex cursor-pointer items-start gap-2 rounded-xl border p-3", !selectedOption ? "border-brand-500" : "border-border")}>
              <input type="radio" name="option" checked={!selectedOption} onChange={() => onSelectOption("")} className="mt-1" />
              <span className="font-medium">The recommended plan above</span>
            </label>
          ) : null}
          {doc.options.map((option) => (
            <label key={option.id} className={cn("flex items-start gap-2 rounded-xl border p-3", onSelectOption ? "cursor-pointer" : "", selectedOption === option.id ? "border-brand-500" : "border-border")}>
              {onSelectOption ? <input type="radio" name="option" checked={selectedOption === option.id} onChange={() => onSelectOption(option.id)} className="mt-1" /> : null}
              <span className="flex-1">
                <span className="font-medium">{option.label}</span>
                {option.description ? <span className="block text-xs text-muted-foreground">{option.description}</span> : null}
                <span className="mt-1 block text-xs">
                  {option.sites.map((s) => `${doc.sites.find((x) => x.key === s.key)?.label ?? ""}: ${s.serviceName ?? "—"} ${s.priceCents !== null ? usd(s.priceCents) : ""}`).join(" · ")}
                </span>
              </span>
            </label>
          ))}
        </section>
      ) : null}

      <section aria-labelledby="terms-h" className="rounded-2xl border border-border bg-card p-4 break-inside-avoid">
        <h2 id="terms-h" className="text-base font-semibold">
          Terms
        </h2>
        <dl className="mt-2 grid gap-1">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Billing</dt>
            <dd className="text-right">
              {doc.terms.invoiceFrequency}
              {doc.terms.netDays !== null ? `, due in ${doc.terms.netDays} days` : ""}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Agreement term</dt>
            <dd>{doc.terms.contractTerm}</dd>
          </div>
          {doc.terms.startPlan ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Getting started</dt>
              <dd className="max-w-[60%] text-right">{doc.terms.startPlan}</dd>
            </div>
          ) : null}
          {doc.sites.length > 1 ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Start</dt>
              <dd>{doc.terms.startTogether ? "All sites start together" : "Each site starts when it's ready"}</dd>
            </div>
          ) : null}
          {doc.terms.rushTerms ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Rush and same-day</dt>
              <dd className="max-w-[60%] text-right">{doc.terms.rushTerms}</dd>
            </div>
          ) : null}
          {doc.terms.restockPolicy ? (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Restocking</dt>
              <dd className="max-w-[60%] text-right">{doc.terms.restockPolicy}</dd>
            </div>
          ) : null}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">How often we clean, how often we invoice and how long the agreement runs are separate. Accepting this proposal is followed by a service agreement to sign; service starts once it is signed and billing and access are set up.</p>
      </section>

      {doc.attachments.length ? (
        <section className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Attachments</h2>
          {doc.attachments.map((a) => (
            <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">
              {a.label}
            </a>
          ))}
        </section>
      ) : null}
    </article>
  );
}
