"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  portalSkipNextVisit,
  portalChangeCadence,
  portalPause,
  portalResume,
  portalCancel,
} from "@/app/actions/portal-actions";

function Btn({
  children,
  onClick,
  busy,
  variant = "solid",
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  variant?: "solid" | "ghost" | "danger";
}) {
  const cls =
    variant === "solid"
      ? "bg-[#4F38FF] text-white"
      : variant === "danger"
        ? "bg-white text-[#E0457B] border border-[#E0457B]/30"
        : "bg-white text-[#141221] border";
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition-opacity disabled:opacity-60 ${cls}`}
    >
      {children}
    </button>
  );
}

export function PortalHome({
  status,
  cadences,
  currentCadenceId,
}: {
  status: string;
  cadences: { id: string; label: string }[];
  currentCadenceId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cadenceOpen, setCadenceOpen] = useState(false);
  const [cancelStep, setCancelStep] = useState<null | "reason" | "confirm">(null);
  const [reason, setReason] = useState<string>("");

  async function run(fn: () => Promise<{ error?: string } | { ok?: boolean }>, ok: string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if ("error" in res && res.error) {
      toast.error("Something went wrong. Please try again.");
      return false;
    }
    toast.success(ok);
    router.refresh();
    return true;
  }

  const REASONS = [
    { key: "too_frequent", label: "It's too frequent" },
    { key: "break", label: "Just taking a break" },
    { key: "too_expensive", label: "It's too expensive" },
    { key: "other", label: "Something else" },
  ];

  return (
    <div className="space-y-3">
      {/* primary actions */}
      <div className="grid gap-2">
        <Btn busy={busy} variant="ghost" onClick={() => run(portalSkipNextVisit, "Your next visit is skipped.")}>
          Skip next visit
        </Btn>
        <Btn busy={busy} variant="ghost" onClick={() => setCadenceOpen((v) => !v)}>
          Change frequency
        </Btn>
        {cadenceOpen && (
          <div className="rounded-xl border bg-white p-3">
            <p className="mb-2 text-xs text-[#6b6880]">Pick how often we visit:</p>
            <div className="grid gap-1.5">
              {cadences.map((c) => (
                <button
                  key={c.id}
                  disabled={busy || c.id === currentCadenceId}
                  onClick={async () => {
                    const ok = await run(
                      () => portalChangeCadence(c.id),
                      "Frequency updated."
                    );
                    if (ok) setCadenceOpen(false);
                  }}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${
                    c.id === currentCadenceId
                      ? "border-[#4F38FF] bg-[#f0eefc] text-[#4F38FF]"
                      : ""
                  }`}
                >
                  {c.label}
                  {c.id === currentCadenceId && " (current)"}
                </button>
              ))}
            </div>
          </div>
        )}
        <Btn busy={busy} variant="ghost" onClick={() => router.push("/payment")}>
          Update card
        </Btn>
        {status === "paused" ? (
          <Btn busy={busy} onClick={() => run(portalResume, "Welcome back — your plan is active.")}>
            Resume service
          </Btn>
        ) : (
          <Btn busy={busy} variant="ghost" onClick={() => run(portalPause, "Your plan is paused.")}>
            Pause service
          </Btn>
        )}
      </div>

      {/* cancel deflection */}
      {cancelStep === null ? (
        <button
          onClick={() => setCancelStep("reason")}
          className="w-full py-2 text-center text-xs text-[#6b6880] underline"
        >
          Cancel my plan
        </button>
      ) : (
        <div className="rounded-2xl border bg-white p-5">
          {cancelStep === "reason" ? (
            <>
              <p className="font-semibold">Before you go — what&apos;s up?</p>
              <p className="mt-1 text-xs text-[#6b6880]">
                There might be an easier fix than cancelling.
              </p>
              <div className="mt-3 grid gap-1.5">
                {REASONS.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => {
                      setReason(r.key);
                      setCancelStep("confirm");
                    }}
                    className="rounded-lg border px-3 py-2 text-left text-sm"
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCancelStep(null)}
                className="mt-3 w-full text-center text-xs text-[#6b6880] underline"
              >
                Never mind
              </button>
            </>
          ) : (
            <>
              {reason === "too_frequent" && (
                <Deflect
                  title="Want fewer visits instead?"
                  body="Switching to a less frequent schedule keeps your spot without cancelling."
                  cta="Change frequency"
                  onCta={() => {
                    setCancelStep(null);
                    setCadenceOpen(true);
                  }}
                />
              )}
              {reason === "break" && (
                <Deflect
                  title="Take a break, keep your spot"
                  body="Pause anytime and resume when you're ready — no need to cancel."
                  cta="Pause instead"
                  onCta={async () => {
                    const ok = await run(portalPause, "Your plan is paused.");
                    if (ok) setCancelStep(null);
                  }}
                />
              )}
              {reason === "too_expensive" && (
                <Deflect
                  title="A lighter schedule costs less"
                  body="A less frequent visit lowers your per-month cost while keeping your home cared for."
                  cta="See options"
                  onCta={() => {
                    setCancelStep(null);
                    setCadenceOpen(true);
                  }}
                />
              )}
              {reason === "other" && (
                <p className="text-sm text-[#6b6880]">
                  We&apos;re sorry to see you go.
                </p>
              )}
              <button
                disabled={busy}
                onClick={async () => {
                  const ok = await run(
                    () => portalCancel(reason),
                    "Your plan is cancelled."
                  );
                  if (ok) setCancelStep(null);
                }}
                className="mt-4 w-full rounded-xl border border-[#E0457B]/30 bg-white px-4 py-3 text-sm font-semibold text-[#E0457B] disabled:opacity-60"
              >
                No thanks, cancel my plan
              </button>
              <button
                onClick={() => setCancelStep(null)}
                className="mt-2 w-full text-center text-xs text-[#6b6880] underline"
              >
                Keep my plan
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Deflect({
  title,
  body,
  cta,
  onCta,
}: {
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-[#6b6880]">{body}</p>
      <button
        onClick={onCta}
        className="w-full rounded-xl bg-[#4F38FF] px-4 py-3 text-sm font-semibold text-white"
      >
        {cta}
      </button>
    </div>
  );
}
