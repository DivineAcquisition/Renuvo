"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useRef, useState } from "react";

import { messageOf } from "@/components/app/form";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { DraftBody } from "../../../../convex/lib/sales/draft";

export type DraftData = NonNullable<FunctionReturnType<typeof api.sales.draft>>;
export type Mode = "booking" | "proposal";
export type Segment = "residential" | "commercial" | "office" | "str";
export type BookingKind = "one_time" | "recurring";

export type Working = {
  mode: Mode;
  segment: Segment;
  bookingKind: BookingKind;
  customerId: Id<"customers"> | null;
  propertyId: Id<"properties"> | null;
  body: DraftBody;
};

export type SaveState = { kind: "saved"; at: number } | { kind: "saving" } | { kind: "dirty" } | { kind: "error"; message: string } | { kind: "conflict" };

const SAVE_DELAY_MS = 700;

/**
 * The draft as the person is editing it, autosaved a moment after they stop typing. The server's revision
 * guards against two windows overwriting each other; a change made by an action (for example a customer
 * added with Quick add) is adopted when nothing is waiting to be saved.
 */
export function useDraft(companyId: Id<"companies">, draftId: Id<"salesDrafts">) {
  const data = useQuery(api.sales.draft, { companyId, draftId });
  const save = useMutation(api.sales.saveDraft);
  const [working, setWorking] = useState<Working | null>(null);
  const [state, setState] = useState<SaveState>({ kind: "saved", at: 0 });
  const revision = useRef<number>(-1);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Working | null>(null);
  const again = useRef<() => void>(() => undefined);

  // Adopt the server's copy on first load, and whenever it moved on while nothing local is pending.
  useEffect(() => {
    if (!data) return;
    if (data.draft.revision === revision.current) return;
    if (dirty.current && revision.current >= 0) return;
    const next: Working = {
      mode: data.draft.mode,
      segment: data.draft.segment,
      bookingKind: data.draft.bookingKind,
      customerId: data.draft.customerId ?? null,
      propertyId: data.draft.propertyId ?? null,
      body: (data.draft.body ?? {}) as DraftBody,
    };
    revision.current = data.draft.revision;
    latest.current = next;
    setWorking(next);
    setState({ kind: "saved", at: data.draft.updatedAt });
  }, [data]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = latest.current;
    if (!value || !dirty.current) return;
    setState({ kind: "saving" });
    try {
      const result = await save({
        companyId,
        draftId,
        revision: revision.current,
        mode: value.mode,
        segment: value.segment,
        bookingKind: value.bookingKind,
        customerId: value.customerId,
        propertyId: value.propertyId,
        body: value.body,
      });
      revision.current = result.revision;
      // Edits made while saving are saved next.
      if (latest.current === value) dirty.current = false;
      setState(dirty.current ? { kind: "dirty" } : { kind: "saved", at: Date.now() });
      if (dirty.current) timer.current = setTimeout(() => again.current(), SAVE_DELAY_MS);
    } catch (caught) {
      const message = messageOf(caught);
      setState(/another window/.test(message) ? { kind: "conflict" } : { kind: "error", message });
    }
  }, [companyId, draftId, save]);
  useEffect(() => {
    again.current = () => void flush();
  }, [flush]);

  const update = useCallback(
    (change: Partial<Working> | ((current: Working) => Working)) => {
      setWorking((current) => {
        if (!current) return current;
        const next = typeof change === "function" ? change(current) : { ...current, ...change };
        latest.current = next;
        dirty.current = true;
        return next;
      });
      setState({ kind: "dirty" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const setBody = useCallback((change: (body: DraftBody) => DraftBody) => update((current) => ({ ...current, body: change(current.body) })), [update]);

  /** Drops local edits and takes the server's latest copy (after a conflict). */
  const reload = useCallback(() => {
    dirty.current = false;
    revision.current = -1;
    if (data) {
      const next: Working = { mode: data.draft.mode, segment: data.draft.segment, bookingKind: data.draft.bookingKind, customerId: data.draft.customerId ?? null, propertyId: data.draft.propertyId ?? null, body: (data.draft.body ?? {}) as DraftBody };
      revision.current = data.draft.revision;
      latest.current = next;
      setWorking(next);
      setState({ kind: "saved", at: data.draft.updatedAt });
    }
  }, [data]);

  // Save before the page goes away.
  useEffect(() => {
    const onHide = () => {
      if (dirty.current) void flush();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (dirty.current) void flush();
    };
  }, [flush]);

  return { data, working, state, update, setBody, flush, reload, revision: () => revision.current };
}
