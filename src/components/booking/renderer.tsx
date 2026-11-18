"use client";

/**
 * One booking surface for the live page and the builder's preview. Both draw these same components with
 * the same server facts; the builder only adds selectable regions and may show unsaved words.
 *
 * The steps shown come from the server's flow for this session, so progress counts only the steps this
 * customer will see. Opening a saved link resumes at the first step still to do.
 */
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Definition, StepId } from "../../../convex/lib/booking/definition";
import { progress as progressOf } from "../../../convex/lib/booking/logic";
import { Ctx, type BookingActions, type BookingCtx, type Result, type SessionView } from "./context";
import { BookingFooter, BookingHeader, EditorProvider, type CompanyFace, type EditorHooks } from "./parts";
import { CheckoutStep, ConfirmationStep, DetailsStep } from "./step-finish";
import { ServiceStep } from "./step-service";
import { LocationStep, SizeStep } from "./step-start";
import { resolveTheme } from "./theme";

export function words(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | undefined;
    if (data && typeof data.message === "string") return data.message;
  }
  return "That didn't go through. Check your connection and try again.";
}

async function attempt<T>(run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; why: string }> {
  try {
    const value = await run();
    if (value && typeof value === "object" && "refused" in value && typeof (value as { refused: unknown }).refused === "string") return { ok: false, why: (value as { refused: string }).refused };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, why: words(error) };
  }
}

/** The step a saved session should open on: the first one still to do. */
export function resumeStep(view: SessionView | null, steps: StepId[]): StepId {
  if (!view) return "location";
  if (view.status === "confirmed" || view.status === "requested" || view.status === "needs_attention") return "confirmation";
  if (!view.contact || view.outOfArea) return "location";
  const has = (s: StepId) => steps.includes(s);
  if (has("size") && view.size.needed && !view.selection && (view.home.area === undefined && view.home.bedrooms === undefined && view.home.beds === undefined)) return "size";
  if (!view.selection || !view.schedule || (!view.request && !view.accepted)) return "service";
  if (view.payment.state === "succeeded" && view.states.answers !== "complete") return "details";
  const detailsFirst = steps.indexOf("details") < steps.indexOf("checkout");
  if (detailsFirst && (view.states.answers !== "complete" || view.states.agreement === "pending")) return "details";
  return "checkout";
}

/** Mutations for a session, worded for the customer. `start` and `sign` go through Selestial's server. */
export function useSessionActions(token: string | null, server: { start: (postalCode: string) => Promise<Result & { token?: string }>; sign: (args: { token: string; signerName: string; drawn?: string; contentHash: string }) => Promise<Result> }): BookingActions {
  const setLocation = useMutation(api.bookingSessions.setLocation);
  const setContact = useMutation(api.bookingSessions.setContact);
  const setHome = useMutation(api.bookingSessions.setHome);
  const selectService = useMutation(api.bookingSessions.selectService);
  const chooseTime = useMutation(api.bookingSessions.chooseTime);
  const acceptQuote = useMutation(api.bookingSessions.acceptQuote);
  const setDetails = useMutation(api.bookingSessions.setDetails);
  const sendRequest = useMutation(api.bookingSessions.sendRequest);
  const confirm = useMutation(api.bookingSessions.confirm);
  const startPayment = useMutation(api.bookingSessions.startPayment);
  const paymentReturned = useMutation(api.bookingSessions.paymentReturned);
  const simulatePayment = useMutation(api.bookingSessions.simulatePayment);
  const updateAccess = useMutation(api.bookingSessions.updateAccess);
  const requestChange = useMutation(api.bookingSessions.requestChange);
  const clientKey = useRef<string | null>(null);
  return useMemo<BookingActions>(() => {
    const t = token ?? "";
    const ok = <T,>(r: { ok: true; value: T } | { ok: false; why: string }): Result => (r.ok ? { ok: true } : r);
    return {
      start: async (postalCode) => {
        const r = await server.start(postalCode);
        return r.ok ? { ok: true } : r;
      },
      setLocation: async (postalCode) => {
        const r = await attempt(() => setLocation({ token: t, postalCode }));
        return r.ok ? { ok: true, inArea: (r.value as { inArea?: boolean }).inArea } : r;
      },
      setContact: async (c) => ok(await attempt(() => setContact({ token: t, ...c }))),
      setHome: async (facts) => ok(await attempt(() => setHome({ token: t, ...facts }))),
      selectService: async (sel) => ok(await attempt(() => selectService({ token: t, ...sel }))),
      chooseTime: async (startsAt) => {
        const r = await attempt(() => chooseTime({ token: t, startsAt }));
        if (!r.ok) return r;
        const v = r.value as { ok?: boolean; why?: string };
        return v.ok === false ? { ok: false, why: v.why ?? "That time can't be held." } : { ok: true };
      },
      acceptQuote: async (inputHash, grandTotalCents) => {
        const r = await attempt(() => acceptQuote({ token: t, inputHash, grandTotalCents }));
        if (!r.ok) return r;
        const v = r.value as { ok?: boolean; why?: string };
        return v.ok === false ? { ok: false, why: v.why ?? "The price changed." } : { ok: true };
      },
      setDetails: async (address, answers) => {
        const r = await attempt(() => setDetails({ token: t, address, answers }));
        return r.ok ? { ok: true, complete: (r.value as { complete?: boolean }).complete } : r;
      },
      sign: async (signerName, drawn, contentHash) => server.sign({ token: t, signerName, drawn, contentHash }),
      sendRequest: async () => ok(await attempt(() => sendRequest({ token: t }))),
      confirm: async () => {
        const r = await attempt(() => confirm({ token: t }));
        if (!r.ok) return r;
        const v = r.value as { ok?: boolean; blockers?: string[] };
        return v.ok === false ? { ok: false, why: (v.blockers ?? []).join(" ") || "The booking can't be confirmed yet." } : { ok: true };
      },
      startPayment: async () => {
        clientKey.current ??= `bk-${crypto.randomUUID()}`;
        const key = clientKey.current;
        const r = await attempt(() => startPayment({ token: t, clientKey: key }));
        clientKey.current = null;
        if (!r.ok) return r;
        return { ok: true, paymentId: (r.value as { paymentId?: string }).paymentId };
      },
      paymentReturned: async (paymentId) => {
        await attempt(() => paymentReturned({ token: t, paymentId: paymentId as Id<"payments"> }));
      },
      simulatePayment: async () => {
        const r = await attempt(() => simulatePayment({ token: t }));
        if (!r.ok) return r;
        const v = r.value as { blockers?: string[] };
        return v.blockers?.length ? { ok: false, why: v.blockers.join(" ") } : { ok: true };
      },
      updateAccess: async (notes) => ok(await attempt(() => updateAccess({ token: t, notes }))),
      requestChange: async (kind, message) => ok(await attempt(() => requestChange({ token: t, kind, message }))),
    };
  }, [token, server, setLocation, setContact, setHome, selectService, chooseTime, acceptQuote, setDetails, sendRequest, confirm, startPayment, paymentReturned, simulatePayment, updateAccess, requestChange]);
}

export type SurfaceProps = {
  def: Definition;
  company: CompanyFace & { brandColor: string; accentColor: string };
  heroUrl: string | null;
  token: string | null;
  view: SessionView | null;
  actions: BookingActions;
  preview?: boolean;
  editor?: EditorHooks;
  /** The builder can ask to show a step; `n` changes on every ask, so asking twice works. */
  showStep?: { step: StepId; n: number } | null;
  className?: string;
};

export function BookingSurface({ def, company, heroUrl, token, view, actions, preview = false, editor, showStep, className }: SurfaceProps) {
  const steps = useMemo<StepId[]>(() => view?.steps ?? def.steps.map((s) => s.id), [view?.steps, def.steps]);
  const [step, setStep] = useState<StepId>(() => resumeStep(view, steps));
  // When the record moves on its own (a payment confirmed by Stripe), the page follows it.
  const [seenStatus, setSeenStatus] = useState(view?.status);
  if (view?.status !== seenStatus) {
    setSeenStatus(view?.status);
    if (view && (view.status === "confirmed" || view.status === "requested" || view.status === "needs_attention")) setStep("confirmation");
  }
  const [seenAsk, setSeenAsk] = useState(showStep?.n);
  if (showStep && showStep.n !== seenAsk) {
    setSeenAsk(showStep.n);
    if (steps.includes(showStep.step)) setStep(showStep.step);
  }
  const top = useRef<HTMLDivElement>(null);
  const go = useCallback((s: StepId) => {
    setStep(s);
    top.current?.scrollIntoView({ block: "start" });
  }, []);
  const active: StepId = steps.includes(step) ? step : steps[0];
  const index = steps.indexOf(active);
  const next = useCallback(() => {
    const i = steps.indexOf(step);
    if (i >= 0 && i < steps.length - 1) go(steps[i + 1]);
  }, [steps, step, go]);
  const back = index > 0 && active !== "confirmation" ? () => go(steps[index - 1]) : null;
  const theme = resolveTheme(def.theme, company);
  const value: BookingCtx = { def, company, heroUrl, token, view, actions, step: active, steps, go, next, back, preview };
  const progress = active === "location" && !view ? { index: 1, total: steps.length, label: "Location" } : progressOf(steps, active);

  const body = (
    <Ctx.Provider value={value}>
      <div ref={top} className={cn("bk @container flex min-h-full flex-col", className)} style={theme.style}>
        <BookingHeader company={company} progress={progress} header={def.header} />
        <main className="flex flex-1 flex-col pb-28 @3xl:pb-8" key={active}>
          <div className="bk-rise flex flex-1 flex-col">
            {active === "location" ? <LocationStep /> : null}
            {active === "size" ? <SizeStep /> : null}
            {active === "service" ? <ServiceStep /> : null}
            {active === "details" ? <DetailsStep /> : null}
            {active === "checkout" ? <CheckoutStep /> : null}
            {active === "confirmation" ? <ConfirmationStep /> : null}
          </div>
        </main>
        <BookingFooter company={company} note={def.content.footerNote} clearBar={active !== "confirmation"} />
      </div>
    </Ctx.Provider>
  );
  return editor ? <EditorProvider value={editor}>{body}</EditorProvider> : body;
}
