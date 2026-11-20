/** The six steps of a migration, and when each is done or can be opened. */
import { IMPORTABLE } from "../../../../convex/lib/migration/rules";
import type { StepId, View } from "./context";

export const STEPS: { id: StepId; label: string; short: string; purpose: string }[] = [
  { id: "source", label: "Choose your source", short: "Source", purpose: "Identify your current system and what you want to move." },
  { id: "files", label: "Add your files", short: "Files", purpose: "Upload exports and say what each contains." },
  { id: "organize", label: "Organize your information", short: "Organize", purpose: "Confirm columns, dates and services." },
  { id: "review", label: "Review & fix", short: "Review", purpose: "Resolve duplicates, missing information and conflicts." },
  { id: "import", label: "Import", short: "Import", purpose: "Bring records in, safely, in the background." },
  { id: "verify", label: "Verify & activate", short: "Verify", purpose: "Check what moved, then decide when agents start." },
];

const importable = (kind: string) => (IMPORTABLE as readonly string[]).includes(kind);

export function organizeIssues(view: View): string[] {
  const out: string[] = [];
  const files = view.files.filter((f) => f.status === "ready" && importable(f.kind));
  for (const file of files) if (!file.mappingConfirmed) out.push(`Confirm the columns of ${file.name}.`);
  const unmatched = view.migration.serviceNames.filter((s) => !view.migration.serviceMap.some((m) => m.name.toLowerCase() === s.name.toLowerCase()) && !s.suggested);
  if (unmatched.length) out.push(`Match ${unmatched.length === 1 ? "1 service name" : `${unmatched.length} service names`} to your Selestial services.`);
  if (!view.migration.dateOrder && !view.migration.dateInfo?.inferred && (view.migration.dateInfo?.ambiguous ?? 0) > 0) out.push("Choose how your files write dates.");
  const scheduled = files.some((f) => f.kind === "recurring" || f.kind === "bookings");
  if (scheduled && !view.migration.timezoneConfirmed) out.push("Confirm your business timezone.");
  return out;
}

export function stepDone(view: View, id: StepId): boolean {
  const s = view.migration.summary;
  switch (id) {
    case "source":
      return view.migration.source !== null;
    case "files":
      return view.files.some((f) => f.status === "ready");
    case "organize":
      return view.files.some((f) => f.status === "ready") && organizeIssues(view).length === 0;
    case "review":
      return view.files.some((f) => f.status === "ready") && Object.values(s).every((k) => (k.awaiting ?? 0) === 0 && (k.error ?? 0) === 0);
    case "import":
      return view.run?.status === "done";
    case "verify":
      return view.migration.releasedAt !== null;
  }
}

export function reachable(view: View, id: StepId): boolean {
  if (id === "source") return true;
  if (id === "files") return true;
  if (id === "verify") return view.run !== null;
  return view.files.some((f) => f.status === "ready");
}

