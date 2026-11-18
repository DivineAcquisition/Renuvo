"use client";

/**
 * The pieces every booking step shares, laid out as the reference booking flow lays them out: a sticky
 * branded header with help links and progress, centered headings, the illustrated size plan, a mobile
 * bottom bar and a quiet footer. Every word and color comes from the company and its experience.
 */
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Phone } from "@phosphor-icons/react";
import { createContext, useContext, type ReactNode } from "react";

import { cn } from "@/lib/utils";

// ── Editing hooks: the builder's preview makes regions selectable; the live page ignores them ──────

export type EditorHooks = { selected: string | null; onSelect: (id: string) => void };
const EditorContext = createContext<EditorHooks | null>(null);
export const EditorProvider = EditorContext.Provider;

/** A region the builder can select. On the live page it renders its children and nothing else. */
export function Editable({ id, label, children, className, as: Tag = "div" }: { id: string; label: string; children: ReactNode; className?: string; as?: "div" | "section" | "header" | "span" }) {
  const editor = useContext(EditorContext);
  if (!editor) return <Tag className={className}>{children}</Tag>;
  return (
    <Tag
      className={cn("bk-editable", className)}
      data-editing={editor.selected === id}
      data-editable={id}
      title={`Edit ${label}`}
      onClickCapture={(event) => {
        const target = event.target as HTMLElement;
        // Controls inside still work for the test booking; a click on the region's own words selects it.
        if (target.closest("button, a, input, select, textarea, label") && !target.closest("[data-editable-text]")) return;
        if (target.closest("[data-editable]") !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        editor.onSelect(id);
      }}
    >
      {children}
    </Tag>
  );
}

export function useEditing(): boolean {
  return useContext(EditorContext) !== null;
}

// ── Header ───────────────────────────────────────────────────────────────────────────────────────

export type CompanyFace = { name: string; phone: string | null; email: string | null; website: string | null; logoUrl: string | null };

export function BookingHeader({ company, progress, header }: { company: CompanyFace; progress: { index: number; total: number; label: string } | null; header: { showPhone: boolean; showWebsite: boolean; showProgress: boolean; helpLabel: string } }) {
  const percent = progress ? Math.round((progress.index / progress.total) * 100) : 0;
  const tel = company.phone ? `tel:${company.phone.replace(/[^\d+]/g, "")}` : null;
  return (
    <Editable id="header" label="the header" as="header" className="sticky top-0 z-40 w-full border-b border-[color:var(--bk-hairline)] bg-white/90 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-4 py-3 @2xl:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {company.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="" className="h-8 w-8 rounded-[9px] object-contain @2xl:h-9 @2xl:w-9" />
            ) : (
              <span aria-hidden className="grid h-8 w-8 place-items-center rounded-[9px] bg-[var(--bk-brand)] text-[13px] font-semibold text-[color:var(--bk-on-brand)] @2xl:h-9 @2xl:w-9">
                {company.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="truncate text-[16px] font-semibold tracking-[-0.02em]">{company.name}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1 @2xl:gap-2">
            {header.showWebsite && company.website ? (
              <a href={company.website} target="_blank" rel="noopener noreferrer" className="hidden items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13.5px] text-[color:var(--bk-muted-text)] hover:bg-[var(--bk-muted)] hover:text-[color:var(--bk-ink)] @2xl:inline-flex">
                Website <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
            {header.showPhone && tel ? (
              <a href={tel} aria-label={`${header.helpLabel || "Call"} ${company.phone}`} className="inline-flex items-center gap-1.5 rounded-[9px] border border-[color:var(--bk-hairline)] bg-white px-3 py-1.5 text-[13.5px] font-medium hover:bg-[var(--bk-muted)]">
                <Phone className="h-4 w-4 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" />
                <span className="hidden @2xl:inline">{company.phone}</span>
                <span className="@2xl:hidden">Call</span>
              </a>
            ) : null}
          </div>
        </div>
        {header.showProgress && progress ? (
          <>
            <div className="mt-3 flex items-center justify-between text-[13px] @2xl:mt-4">
              <p>
                <span className="font-mono text-[12px] text-[color:var(--bk-brand-text)]">
                  {String(progress.index).padStart(2, "0")}/{String(progress.total).padStart(2, "0")}
                </span>
                <span className="ml-2 font-medium">{progress.label}</span>
              </p>
              <p className="text-[color:var(--bk-muted-text)]">{percent}%</p>
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#ecEAf2]" role="progressbar" aria-valuemin={1} aria-valuemax={progress.total} aria-valuenow={progress.index} aria-label={`Step ${progress.index} of ${progress.total}: ${progress.label}`}>
              <div className="h-full rounded-full bg-[var(--bk-accent)] motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${percent}%` }} />
            </div>
          </>
        ) : null}
      </div>
    </Editable>
  );
}

// ── Headings ─────────────────────────────────────────────────────────────────────────────────────

export function StepHeading({ id, title, subtitle, icon, size = "md", eyebrow }: { id: string; title: string; subtitle: string; icon?: ReactNode; size?: "md" | "lg"; eyebrow?: ReactNode }) {
  return (
    <Editable id={id} label="the heading" className="mb-8 text-center @3xl:mb-10">
      {icon ? <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-[var(--bk-muted)] @3xl:mb-6 @3xl:h-16 @3xl:w-16">{icon}</div> : null}
      {eyebrow}
      <h1 data-editable-text className={cn("font-semibold tracking-[-0.03em]", size === "lg" ? "text-3xl @3xl:text-4xl @5xl:text-5xl" : "text-2xl @3xl:text-3xl")}>{title}</h1>
      {subtitle ? <p data-editable-text className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-[color:var(--bk-muted-text)] @3xl:text-base">{subtitle}</p> : null}
    </Editable>
  );
}

// ── Mobile bottom bar ───────────────────────────────────────────────────────────────────────────

export function BottomBar({ onBack, onContinue, continueLabel, disabled, priceCents, priceLabel, busy }: { onBack?: () => void; onContinue?: () => void; continueLabel: string; disabled?: boolean; priceCents?: number | null; priceLabel?: string; busy?: boolean }) {
  if (!onBack && !onContinue) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--bk-hairline)] bg-white/90 pb-[env(safe-area-inset-bottom)] shadow-[0_-16px_40px_-20px_rgb(var(--bk-brand-rgb)/0.18)] backdrop-blur-xl @3xl:hidden">
      {priceCents !== undefined && priceCents !== null ? (
        <div className="flex items-baseline justify-between px-4 pt-2 text-[13px]">
          <span className="text-[color:var(--bk-muted-text)]">{priceLabel ?? "Total"}</span>
          <span className="font-semibold tabular-nums">${(priceCents / 100).toFixed(2)}</span>
        </div>
      ) : null}
      <div className="flex gap-2 p-3">
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Go back" className="bk-btn-outline h-12 w-12 shrink-0">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
        {onContinue ? (
          <button type="button" onClick={onContinue} disabled={disabled || busy} className="bk-btn h-12 flex-1 text-base">
            {busy ? "Working…" : continueLabel}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────────────────────────

export function BookingFooter({ company, note, clearBar }: { company: CompanyFace; note: string; clearBar?: boolean }) {
  return (
    <footer className={cn("mt-auto border-t border-[color:var(--bk-hairline)] bg-white px-4 pb-8 pt-8", clearBar && "pb-36 @3xl:pb-8")}>
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 text-center">
        <p className="text-sm font-semibold">{company.name}</p>
        <p className="text-xs leading-5 text-zinc-700">
          {[company.phone, company.email].filter(Boolean).map((item, i) => (
            <span key={item}>
              {i > 0 ? <span className="mx-2 text-zinc-400">·</span> : null}
              {item}
            </span>
          ))}
        </p>
        {note ? <p className="max-w-xl text-[11px] leading-5 text-zinc-500">{note}</p> : null}
        <p className="text-[11px] text-zinc-500">Booking by Selestial</p>
      </div>
    </footer>
  );
}

// ── The size illustration: a house that grows inside a fixed lot ─────────────────────────────────

const GRIDS: Array<readonly [number, number]> = [
  [1, 1],
  [2, 1],
  [2, 2],
  [3, 2],
  [3, 2],
  [3, 3],
  [4, 2],
  [4, 3],
];

export function HomeSizePlan({ index, total, selected }: { index: number; total: number; selected: boolean }) {
  const t = total <= 1 ? 1 : index / Math.max(1, total - 1);
  const [cols, rows] = GRIDS[Math.min(index, GRIDS.length - 1)];
  const lot = { x: 16, y: 8, w: 128, h: 86 };
  const scale = 0.42 + t * 0.58;
  const w = lot.w * scale;
  const h = lot.h * scale;
  const x = lot.x + (lot.w - w) / 2;
  const y = lot.y + lot.h - h;
  const door = Math.min(12, Math.max(7, w * 0.22));
  const doorX = x + w / 2 - door / 2;
  const cellW = w / cols;
  const cellH = h / rows;
  const interior: string[] = [];
  for (let c = 1; c < cols; c += 1) interior.push(`M ${x + c * cellW} ${y} V ${y + h}`);
  for (let r = 1; r < rows; r += 1) interior.push(`M ${x} ${y + r * cellH} H ${x + w}`);
  return (
    <svg viewBox="0 0 160 108" className="mx-auto h-[4.75rem] w-full max-w-[11rem]" style={{ color: selected ? "var(--bk-brand)" : "rgb(var(--bk-brand-rgb) / 0.75)" }} aria-hidden>
      <rect x={lot.x} y={lot.y} width={lot.w} height={lot.h} rx="6" fill="none" stroke="#e9e7ee" strokeWidth="1" strokeDasharray="3 3" />
      <rect x={x} y={y} width={w} height={h} rx="1.5" fill="currentColor" opacity={selected ? 0.2 : 0.1} />
      <path d={[`M ${x} ${y + h}`, `V ${y}`, `H ${x + w}`, `V ${y + h}`, `H ${doorX + door}`, `M ${doorX} ${y + h}`, `H ${x}`].join(" ")} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      {interior.length > 0 ? <path d={interior.join(" ")} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" /> : null}
      <path d={`M ${doorX} ${y + h} A ${door} ${door} 0 0 0 ${doorX + door} ${y + h}`} fill="none" stroke="currentColor" strokeWidth="1" opacity="0.8" />
    </svg>
  );
}

export function SelectedMark() {
  return (
    <span aria-hidden className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-[var(--bk-brand)] text-[color:var(--bk-on-brand)]">
      <Check className="h-3.5 w-3.5" weight="bold" />
    </span>
  );
}

export function Pill({ children, tone = "brand", className }: { children: ReactNode; tone?: "brand" | "solid" | "good" | "warn" | "muted"; className?: string }) {
  const tones = {
    brand: "border border-[rgb(var(--bk-brand-rgb)/0.4)] bg-[rgb(var(--bk-brand-rgb)/0.08)] text-[color:var(--bk-brand-text)]",
    solid: "bk-solid shadow-lg",
    good: "border border-emerald-200 bg-emerald-50 text-emerald-800",
    warn: "border border-amber-200 bg-amber-50 text-amber-900",
    muted: "border border-[color:var(--bk-hairline)] bg-[var(--bk-muted)] text-[color:var(--bk-muted-text)]",
  };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider", tones[tone], className)}>{children}</span>;
}

export function Field({ id, label, required, help, error, children }: { id: string; label: string; required?: boolean; help?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-left text-sm font-medium">
        {label}
        {required ? <span className="text-red-700"> *</span> : null}
      </label>
      {children}
      {help ? <p className="text-left text-xs text-[color:var(--bk-muted-text)]">{help}</p> : null}
      {error ? (
        <p role="alert" className="text-left text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "good" | "bad"; title: string; children?: ReactNode }) {
  const tones = { info: "border-[rgb(var(--bk-brand-rgb)/0.2)] bg-[rgb(var(--bk-brand-rgb)/0.05)]", warn: "border-amber-200 bg-amber-50", good: "border-emerald-200 bg-emerald-50", bad: "border-red-200 bg-red-50" };
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("rounded-[calc(var(--bk-radius)*0.75)] border p-4 text-left text-sm", tones[tone])}>
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1 text-[color:var(--bk-muted-text)]">{children}</div> : null}
    </div>
  );
}
