"use client";

/**
 * A company's public booking form. Anyone with the address may open it; nothing about the company is
 * shown beyond its name, the questions it published and the services it chose to list. A form that was
 * taken offline keeps its address and says it is closed.
 *
 * `?embed=1` drops the page chrome so the form sits inside a company's own website.
 */
import { useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { submitBookingForm } from "@/app/c/form/actions";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import { BookingFormBody, EMPTY_VALUES, FormConfirmation, type FormValues } from "./form-fields";

function key(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `f-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function Frame({ embed, children }: { embed: boolean; children: React.ReactNode }) {
  if (embed) return <main className="mx-auto w-full max-w-xl px-4 py-5">{children}</main>;
  return (
    <main className="min-h-dvh bg-muted/50">
      <div className="h-32 bg-[radial-gradient(140%_120%_at_10%_0%,color-mix(in_oklab,var(--color-brand-500)_26%,transparent),transparent_70%)]" aria-hidden />
      <div className="mx-auto -mt-24 w-full max-w-xl px-4 pb-16">
        <section className="rounded-3xl border border-border bg-card p-5 shadow-[0_24px_60px_-32px_rgba(27,14,69,0.35)] sm:p-7">{children}</section>
        <p className="mt-4 text-center text-xs text-muted-foreground">Your answers go only to the business named above.</p>
      </div>
    </main>
  );
}

export function BookingFormPage({ publicId, embed = false }: { publicId: string; embed?: boolean }) {
  const view = useQuery(api.salesFormPages.view, { publicId });
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ title: string; body: string } | null>(null);
  const opened = useRef<number>(0);
  const clientKey = useRef<string>("");
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    opened.current = Date.now();
    clientKey.current = key();
  }, []);

  const submit = async () => {
    if (!view || !view.open) return;
    setBusy(true);
    setProblems({});
    const query = new URLSearchParams(window.location.search);
    let referrer = "";
    try {
      referrer = document.referrer ? new URL(document.referrer).hostname : "";
    } catch {
      referrer = "";
    }
    const result = await submitBookingForm({
      publicId,
      name: values.name,
      email: values.email,
      phone: values.phone,
      serviceKey: values.serviceKey,
      answers: values.answers,
      smsConsent: values.smsConsent,
      website: values.website,
      elapsedMs: Date.now() - opened.current,
      clientKey: clientKey.current,
      campaign: query.get("utm_campaign") ?? undefined,
      medium: query.get("utm_medium") ?? undefined,
      referrer: referrer || undefined,
    }).catch(() => ({ status: "unavailable" as const }));
    setBusy(false);
    if (result.status === "saved") {
      setDone({ title: result.title, body: result.body });
      top.current?.scrollIntoView({ block: "start" });
      return;
    }
    if (result.status === "invalid") {
      setProblems({ ...result.problems, form: result.problems.form ?? "Some answers need another look. They are marked above." });
      return;
    }
    setProblems({
      form:
        result.status === "limited"
          ? "That's a lot of requests in a short time. Please wait a little and try again, or contact the business directly."
          : result.status === "closed"
            ? "This form is no longer taking requests."
            : "Your request was not sent. Check your connection and try again. Nothing has been saved.",
    });
  };

  if (view === undefined) {
    return (
      <Frame embed={embed}>
        <div aria-busy="true" aria-label="Loading the form" className="grid gap-3">
          <div className="h-8 w-2/3 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
          <div className="h-4 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-12 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
          ))}
        </div>
      </Frame>
    );
  }
  if (view === null) {
    return (
      <Frame embed={embed}>
        <h1 className="text-lg font-semibold text-strong">This form can’t be found</h1>
        <p className="mt-1 text-sm text-muted-foreground">The address may be incomplete. Check the link you were given, or contact the business directly.</p>
      </Frame>
    );
  }
  if (!view.open) {
    return (
      <Frame embed={embed}>
        <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">{view.company}</p>
        <h1 className="mt-2 text-lg font-semibold text-strong">This form is closed</h1>
        <p className="mt-1 text-sm text-muted-foreground">{view.company} is not taking requests through this form right now. Please contact them directly.</p>
      </Frame>
    );
  }
  return (
    <Frame embed={embed}>
      <div ref={top} className={cn("scroll-mt-6")}>
        {done ? <FormConfirmation title={done.title} body={done.body} company={view.company} /> : <BookingFormBody definition={view.form} company={view.company} services={view.services} values={values} onChange={setValues} problems={problems} onSubmit={() => void submit()} busy={busy} />}
      </div>
    </Frame>
  );
}
