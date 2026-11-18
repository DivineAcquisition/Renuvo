"use client";

import type { FunctionReturnType } from "convex/server";
import { createContext, useContext } from "react";

import type { api } from "../../../convex/_generated/api";
import type { Definition, StepId } from "../../../convex/lib/booking/definition";
import type { CompanyFace } from "./parts";

export type SessionView = Extract<FunctionReturnType<typeof api.bookingSessions.view>, { ended: false }>;

export type Result = { ok: true } | { ok: false; why: string };

/** What a step can ask for. Each answers in words a customer can act on, never a provider's error. */
export type BookingActions = {
  /** Live page only: starts a session with the ZIP code. */
  start: (postalCode: string) => Promise<Result>;
  setLocation: (postalCode: string) => Promise<Result & { inArea?: boolean }>;
  setContact: (c: { firstName: string; lastName: string; email: string; phone: string; textOk: boolean }) => Promise<Result>;
  setHome: (facts: { sizeKey?: string; area?: number; bedrooms?: number; bathrooms?: number; halfBaths?: number; beds?: number }) => Promise<Result>;
  selectService: (sel: { serviceKey: string; condition?: string; schedule?: string; units?: number; addOns: { id: string; quantity: number }[]; answers: Record<string, string | number | boolean> }) => Promise<Result>;
  chooseTime: (startsAt: number) => Promise<Result>;
  acceptQuote: (inputHash: string, grandTotalCents: number) => Promise<Result>;
  setDetails: (address: { line1: string; line2?: string; city: string; region: string; postalCode: string }, answers: Record<string, string | number | boolean | string[]>) => Promise<Result & { complete?: boolean }>;
  sign: (signerName: string, drawn: string | undefined, contentHash: string) => Promise<Result>;
  sendRequest: () => Promise<Result>;
  confirm: () => Promise<Result>;
  startPayment: () => Promise<Result & { paymentId?: string }>;
  paymentReturned: (paymentId: string) => Promise<void>;
  simulatePayment: () => Promise<Result>;
  updateAccess: (notes: string) => Promise<Result>;
  requestChange: (kind: "reschedule" | "cancel" | "other", message: string) => Promise<Result>;
};

export type BookingCtx = {
  def: Definition;
  company: CompanyFace & { brandColor: string; accentColor: string };
  heroUrl: string | null;
  token: string | null;
  view: SessionView | null;
  actions: BookingActions;
  step: StepId;
  steps: StepId[];
  go: (step: StepId) => void;
  next: () => void;
  back: (() => void) | null;
  preview: boolean;
};

export const Ctx = createContext<BookingCtx | null>(null);

export function useBooking(): BookingCtx {
  const value = useContext(Ctx);
  if (!value) throw new Error("useBooking outside a booking");
  return value;
}

export function copyOf(def: Definition, step: StepId) {
  return def.steps.find((s) => s.id === step)!;
}

export function sectionOn(def: Definition, step: StepId, section: string): boolean {
  return copyOf(def, step).sections.some((s) => s.id === section && !s.hidden);
}
