"use client";

/**
 * Brings in prospects a company was already talking to before Sales: pasted one per line, read into
 * rows, and reviewed before anything is written. An imported contact is not permission to message
 * anyone, so each one is filed waiting on a person, who records how that prospect agreed to be contacted.
 */
import { useMutation } from "convex/react";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { Upload } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { api } from "../../../../../convex/_generated/api";

type Kind = "residential" | "commercial" | "short_term_rental";
type Row = { name: string; email?: string; phone?: string; note: string; problem: string | null };

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const PHONE = /^\+?[\d\s().-]{7,20}$/;

/** One line is "Name, phone or email, anything else". Commas, tabs or semicolons separate the parts. */
export function readProspects(text: string): Row[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 200)
    .map((line) => {
      const parts = line.split(/[,\t;]/).map((part) => part.trim()).filter(Boolean);
      const email = parts.find((part) => EMAIL.test(part));
      const phone = parts.find((part) => part !== email && PHONE.test(part) && part.replace(/\D/g, "").length >= 7);
      const rest = parts.filter((part) => part !== email && part !== phone);
      const name = rest[0] ?? "";
      const note = rest.slice(1).join(", ");
      const problem = !name ? "No name" : !email && !phone ? "No phone number or email address" : null;
      return { name, ...(email ? { email } : {}), ...(phone ? { phone } : {}), note, problem };
    });
}

function ImportForm({ onDone }: { onDone: () => void }) {
  const { companyId } = useCompany();
  const importProspects = useMutation(api.salesInquiries.importProspects);
  const { busy, error, run } = useRun();
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("residential");
  const [result, setResult] = useState<{ added: number; existing: number } | null>(null);
  const rows = useMemo(() => readProspects(text), [text]);
  const good = rows.filter((row) => !row.problem).slice(0, 100);
  const skipped = rows.length - good.length;

  if (result) {
    return (
      <div className="grid gap-3">
        <p className="rounded-xl border border-success/40 bg-success/10 px-3.5 py-3 text-sm text-strong" role="status">
          {result.added} {result.added === 1 ? "prospect was" : "prospects were"} added{result.existing > 0 ? `, and ${result.existing} already on record ${result.existing === 1 ? "was" : "were"} left as ${result.existing === 1 ? "it is" : "they are"}` : ""}.
        </p>
        <p className="text-sm text-muted-foreground">Each one is in the pipeline under New, waiting on you. Open it, and add the inquiry’s details and how the person agreed to be contacted. Sales writes to nobody until then.</p>
        <div>
          <Button variant="outline" size="sm" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <Field label="One prospect per line" hint="Name, then a phone number or an email address, then anything worth noting. For example: Dana Whitfield, 512-555-0142, asked about a deep clean in May">
        <TextArea value={text} onChange={(event) => setText(event.target.value)} rows={6} placeholder={"Dana Whitfield, 512-555-0142, asked about a deep clean\nSam Ortiz, sam@example.com"} />
      </Field>
      <Field label="Kind of work">
        <SelectInput value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
          <option value="residential">Home</option>
          <option value="commercial">Commercial</option>
          <option value="short_term_rental">Short-term rental</option>
        </SelectInput>
      </Field>
      {rows.length > 0 ? (
        <div className="max-h-56 overflow-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">What will be imported</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Reach them at</th>
                <th scope="col" className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, index) => (
                <tr key={`${row.name}-${index}`} className={row.problem ? "bg-warning/10" : ""}>
                  <td className="px-3 py-1.5 text-strong">{row.name || "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{row.problem ? <span className="font-medium text-warning-foreground">Skipped: {row.problem.toLowerCase()}</span> : [row.phone, row.email].filter(Boolean).join(" · ")}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">Having someone’s number or address is not permission to message them. Imported prospects are filed without it: Sales contacts none of them until a person records how each agreed. Someone already on record is matched, not duplicated.</p>
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" loading={busy} disabled={good.length === 0} onClick={() => void run(async () => setResult(await importProspects({ companyId, rows: good.map((row) => ({ name: row.name, ...(row.email ? { email: row.email } : {}), ...(row.phone ? { phone: row.phone } : {}), kind, note: row.note })) })))}>
          Import {good.length} {good.length === 1 ? "prospect" : "prospects"}
        </Button>
        {skipped > 0 ? <span className="text-xs text-muted-foreground">{skipped} {skipped === 1 ? "line" : "lines"} will be skipped{rows.length - skipped > 100 ? " (100 at a time)" : ""}.</span> : null}
      </div>
    </div>
  );
}

export function ImportProspectsButton() {
  const { role } = useCompany();
  const [open, setOpen] = useState(false);
  if (role === "office") return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Upload aria-hidden />
        Import prospects
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Import open prospects" description="For people you were already talking to before Sales. Review the rows before anything is added.">
        <ImportForm onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
