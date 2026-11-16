"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { useChat, type OfferedRecord } from "@/components/app/chat/chat-context";
import { useCompany } from "@/components/app/company";
import { messageOf } from "@/components/app/form";
import { ArrowUp, BroomIcon, Check, ChevronDown, FileText, HouseIcon, MapPin, Paperclip, Plus, Search, Square, X } from "@/components/icons";
import { Spinner } from "@/components/ui/spinner";
import { newClientKey } from "@/lib/app/chat/session";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { ModelMakerIcon } from "./model-icons";

export type Outgoing = { text: string; clientKey: string; includePage: boolean; records: OfferedRecord[]; files: { storageId: string; name: string }[] };

type Upload = { id: string; name: string; storageId: string | null; error: string | null };

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.markdown,.csv,.json,application/pdf,image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown,text/csv,application/json";
const chip = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500";

/** Search the company's customers, cleaners and drafts, and attach one as context. */
function RecordPicker({ onPick, onClose }: { onPick: (record: OfferedRecord & { label: string }) => void; onClose: () => void }) {
  const { companyId } = useCompany();
  const [query, setQuery] = useState("");
  const customers = useQuery(api.customers.list, { companyId });
  const cleaners = useQuery(api.cleaners.list, { companyId });
  const drafts = useQuery(api.chatArtifacts.list, { companyId, paginationOpts: { numItems: 30, cursor: null } });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const rows = useMemo(() => {
    const all: (OfferedRecord & { label: string; kind: string })[] = [
      ...(customers ?? []).map((row) => ({ table: "customers" as const, id: row._id as string, label: row.name, kind: "Customer" })),
      ...(cleaners ?? []).map((row) => ({ table: "cleaners" as const, id: row._id as string, label: row.name, kind: "Cleaner" })),
      ...(drafts?.page ?? []).map((row) => ({ table: "chatArtifacts" as const, id: row.artifactId as string, label: row.title, kind: "Draft" })),
    ];
    const needle = query.trim().toLowerCase();
    return (needle ? all.filter((row) => row.label.toLowerCase().includes(needle)) : all).slice(0, 12);
  }, [customers, cleaners, drafts, query]);
  const loading = customers === undefined || cleaners === undefined || drafts === undefined;
  return (
    <div
      className="live-enter absolute bottom-full left-0 z-30 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-2 shadow-xl"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <label className="flex items-center gap-2 rounded-lg border border-border px-2.5">
        <Search className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="sr-only">Find a customer, cleaner or draft</span>
        <input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a customer, cleaner or draft" className="h-9 w-full bg-transparent text-sm text-strong outline-none placeholder:text-muted-foreground" />
      </label>
      <ul className="mt-1.5 grid max-h-64 gap-0.5 overflow-y-auto" role="listbox" aria-label="Records">
        {loading ? <li className="px-2.5 py-2 text-xs text-muted-foreground">Loading…</li> : null}
        {!loading && rows.length === 0 ? <li className="px-2.5 py-2 text-xs text-muted-foreground">Nothing matches.</li> : null}
        {rows.map((row) => (
          <li key={`${row.table}:${row.id}`} role="option" aria-selected={false}>
            <button type="button" onClick={() => onPick(row)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500">
              {row.table === "customers" ? <HouseIcon className="size-3.5 text-muted-foreground" aria-hidden /> : row.table === "cleaners" ? <BroomIcon className="size-3.5 text-muted-foreground" aria-hidden /> : <FileText className="size-3.5 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <span className="text-[11px] text-muted-foreground">{row.kind}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Which model answers next. Only models Selestial offers here are listed; the server checks the pick again. */
function ModelPicker({ value, disabled, onPick }: { value: string | null; disabled: boolean; onPick: (key: string) => void }) {
  const { companyId } = useCompany();
  const models = useQuery(api.chat.models, { companyId });
  const [open, setOpen] = useState(false);
  if (!models) return null;
  const current = models.options.find((row) => row.key === (value ?? models.defaultKey)) ?? models.options[0];
  // One group per maker, in the order Selestial lists them.
  const groups: { maker: string; name: string; rows: typeof models.options }[] = [];
  for (const row of models.options) {
    const group = groups.find((entry) => entry.maker === row.maker);
    if (group) group.rows.push(row);
    else groups.push({ maker: row.maker, name: row.makerName, rows: [row] });
  }
  return (
    <div className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((before) => !before)} aria-haspopup="listbox" aria-expanded={open} aria-label={`Model: ${current.label}. Change model`} className={cn(chip, "max-w-48 border-border text-muted-foreground hover:text-strong disabled:opacity-50", open && "border-brand-500/30 bg-brand-500/10 text-brand-300")}>
        <ModelMakerIcon maker={current.maker} className="size-3.5" />
        <span className="truncate">{current.label}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </button>
      {open ? (
        <div role="listbox" aria-label="Choose a model" tabIndex={-1} onKeyDown={(event) => event.key === "Escape" && setOpen(false)} className="live-enter absolute bottom-full left-0 z-30 mb-2 max-h-[min(28rem,60vh)] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-xl">
          {groups.map((group) => (
            <div key={group.maker} className="py-0.5">
              <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{group.name}</p>
              {group.rows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  role="option"
                  aria-selected={row.key === current.key}
                  aria-disabled={!row.available}
                  title={row.why ?? undefined}
                  onClick={() => {
                    if (!row.available) return;
                    setOpen(false);
                    if (row.key !== current.key) onPick(row.key);
                  }}
                  className={cn("flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left", row.available ? "hover:bg-muted" : "cursor-not-allowed opacity-50")}
                >
                  <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                    <ModelMakerIcon maker={row.maker} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-strong">{row.label}</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">{row.available ? `${row.cost} · ${row.bestFor}` : row.why}</span>
                  </span>
                  {row.key === current.key ? <Check className="mt-1 size-4 text-brand-300" aria-hidden /> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Composer({
  compact,
  working,
  stopping,
  seed,
  placeholder,
  autoFocus,
  onSend,
  onStop,
  model,
  onModel,
}: {
  compact?: boolean;
  working: boolean;
  stopping: boolean;
  seed?: string;
  placeholder: string;
  autoFocus?: boolean;
  onSend: (outgoing: Outgoing) => Promise<void>;
  onStop: () => Promise<void>;
  /** The chosen model's key; null until known (the default is shown). */
  model?: string | null;
  onModel?: (key: string) => Promise<void>;
}) {
  const { companyId } = useCompany();
  const { page, offered } = useChat();
  const resolved = useQuery(api.chat.resolveContext, offered.length ? { companyId, refs: offered } : "skip");
  const usage = useQuery(api.chat.usage, { companyId });
  const uploadUrl = useMutation(api.chat.uploadUrl);
  const register = useMutation(api.chat.registerUpload);
  const [text, setText] = useState(seed ?? "");
  const [includePage, setIncludePage] = useState(true);
  const [removed, setRemoved] = useState<string[]>([]);
  const [picked, setPicked] = useState<(OfferedRecord & { label: string })[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [menu, setMenu] = useState<"none" | "plus" | "record">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientKey, setClientKey] = useState(newClientKey);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const label = useId();

  // A starter the person picked fills the box; the person still sends it.
  const [seenSeed, setSeenSeed] = useState(seed);
  if (seed !== seenSeed) {
    setSeenSeed(seed);
    if (seed) setText(seed);
  }
  useEffect(() => {
    if (seed) area.current?.focus();
  }, [seed]);
  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, compact ? 180 : 260)}px`;
  }, [text, compact]);

  const records = [...(resolved ?? []).filter((ref) => !removed.includes(`${ref.table}:${ref.id}`)), ...picked.filter((ref) => !(resolved ?? []).some((other) => other.table === ref.table && other.id === ref.id))];
  const uploading = uploads.some((upload) => !upload.storageId && !upload.error);
  const canSend = text.trim().length > 0 && !busy && !working && !uploading;

  const attach = async (files: FileList | null) => {
    if (!files) return;
    for (const one of Array.from(files).slice(0, 5)) {
      const id = newClientKey();
      setUploads((before) => [...before, { id, name: one.name, storageId: null, error: null }]);
      try {
        const pdf = /\.pdf$/i.test(one.name);
        const image = /\.(png|jpe?g|webp|gif)$/i.test(one.name);
        if (!pdf && !image && !/\.(txt|md|markdown|csv|json)$/i.test(one.name)) throw new Error("Only PDFs, images and text files (.pdf, .png, .jpg, .webp, .gif, .txt, .md, .csv, .json) can be read.");
        if (one.size > (pdf ? 10 * 1024 * 1024 : image ? 5 * 1024 * 1024 : 512 * 1024)) throw new Error(pdf ? "Larger than 10 MB." : image ? "Larger than 5 MB." : "Larger than 512 KB.");
        const url = await uploadUrl({ companyId });
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": one.type || "text/plain" }, body: one });
        if (!response.ok) throw new Error("The upload did not finish.");
        const { storageId } = (await response.json()) as { storageId: string };
        await register({ companyId, storageId: storageId as never });
        setUploads((before) => before.map((upload) => (upload.id === id ? { ...upload, storageId } : upload)));
      } catch (caught) {
        const words = caught instanceof Error && !("data" in (caught as object)) ? caught.message : messageOf(caught);
        setUploads((before) => before.map((upload) => (upload.id === id ? { ...upload, error: words } : upload)));
      }
    }
    if (file.current) file.current.value = "";
  };

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    try {
      await onSend({ text: text.trim(), clientKey, includePage: includePage && Boolean(page), records: records.map((ref) => ({ table: ref.table, id: ref.id })), files: uploads.filter((upload) => upload.storageId).map((upload) => ({ storageId: upload.storageId!, name: upload.name })) });
      setText("");
      setUploads([]);
      setPicked([]);
      setClientKey(newClientKey());
    } catch (caught) {
      // The same key is kept, so sending again cannot make a second copy.
      setError(messageOf(caught));
    } finally {
      setBusy(false);
      area.current?.focus();
    }
  };

  const contextChips = (page && includePage) || records.length > 0 || uploads.length > 0;
  return (
    <div>
      <form
        className={cn("relative rounded-2xl border border-border bg-card p-2 shadow-sm transition-colors focus-within:border-brand-500/50", !compact && "p-2.5 shadow-[0_18px_50px_-30px_rgba(104,56,239,0.55)]")}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {contextChips ? (
          <div className="flex flex-wrap items-center gap-1.5 px-1.5 pt-1 pb-1.5">
            <span className="text-[11px] text-muted-foreground">This chat will be told:</span>
            {page && includePage ? (
              <span className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-strong">
                <MapPin className="size-3 text-brand-300" aria-hidden /> You are on {page.label}
                <button type="button" onClick={() => setIncludePage(false)} aria-label="Do not tell the chat which page you are on" className="ml-0.5 rounded text-muted-foreground hover:text-strong">
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ) : null}
            {records.map((ref) => (
              <span key={`${ref.table}:${ref.id}`} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-strong">
                <Paperclip className="size-3 text-brand-300" aria-hidden /> {ref.label}
                <button
                  type="button"
                  onClick={() => {
                    setRemoved((before) => [...before, `${ref.table}:${ref.id}`]);
                    setPicked((before) => before.filter((other) => !(other.table === ref.table && other.id === ref.id)));
                  }}
                  aria-label={`Remove ${ref.label}`}
                  className="ml-0.5 rounded text-muted-foreground hover:text-strong"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
            {uploads.map((upload) => (
              <span key={upload.id} className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs", upload.error ? "border-destructive/40 text-destructive-foreground" : "border-border text-strong")} title={upload.error ?? undefined}>
                {upload.storageId || upload.error ? <FileText className="size-3 text-brand-300" aria-hidden /> : <Spinner className="size-3" />}
                {upload.name}
                {upload.error ? `: ${upload.error}` : ""}
                <button type="button" onClick={() => setUploads((before) => before.filter((other) => other.id !== upload.id))} aria-label={`Remove ${upload.name}`} className="ml-0.5 rounded text-muted-foreground hover:text-strong">
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <label htmlFor={label} className="sr-only">
          Message Selestial
        </label>
        <textarea
          id={label}
          ref={area}
          value={text}
          rows={compact ? 2 : 3}
          maxLength={20_000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          className="block w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-strong outline-none placeholder:text-muted-foreground/80"
        />
        <div className="flex items-center gap-1.5 px-0.5 pt-1">
          <div className="relative">
            <button type="button" onClick={() => setMenu((before) => (before === "none" ? "plus" : "none"))} aria-haspopup="menu" aria-expanded={menu !== "none"} aria-label="Add files or records" className={cn(chip, "w-8 justify-center px-0", menu !== "none" ? "border-brand-500/30 bg-brand-500/10 text-brand-300" : "border-border text-muted-foreground hover:text-strong")}>
              <Plus className="size-4" aria-hidden />
            </button>
            {menu === "plus" ? (
              <ul role="menu" aria-label="Add" className="live-enter absolute bottom-full left-0 z-30 mb-2 grid w-56 gap-0.5 rounded-xl border border-border bg-card p-1 shadow-xl" onKeyDown={(event) => event.key === "Escape" && setMenu("none")}>
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    autoFocus
                    onClick={() => {
                      setMenu("none");
                      file.current?.click();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted"
                  >
                    <Paperclip className="size-4 text-muted-foreground" aria-hidden />
                    <span className="flex-1">Attach a file</span>
                    <span className="text-[11px] text-muted-foreground">PDF, image, text</span>
                  </button>
                </li>
                <li role="none">
                  <button type="button" role="menuitem" onClick={() => setMenu("record")} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted">
                    <HouseIcon className="size-4 text-muted-foreground" aria-hidden />
                    Attach a business record
                  </button>
                </li>
              </ul>
            ) : null}
            {menu === "record" ? (
              <RecordPicker
                onClose={() => setMenu("none")}
                onPick={(record) => {
                  setPicked((before) => (before.some((other) => other.table === record.table && other.id === record.id) ? before : [...before, record]));
                  setRemoved((before) => before.filter((key) => key !== `${record.table}:${record.id}`));
                  setMenu("none");
                  area.current?.focus();
                }}
              />
            ) : null}
            <input ref={file} type="file" accept={ACCEPT} multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => void attach(event.target.files)} />
          </div>
          {onModel ? <ModelPicker value={model ?? null} disabled={working} onPick={(key) => onModel(key).catch((caught: unknown) => setError(messageOf(caught)))} /> : null}
          {page && !includePage ? (
            <button type="button" onClick={() => setIncludePage(true)} className={cn(chip, "border-border text-muted-foreground hover:text-strong")}>
              <MapPin className="size-3.5" aria-hidden /> Include this page
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {working ? (
              <button type="button" onClick={() => void onStop()} disabled={stopping} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-medium text-strong hover:border-destructive/40 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-60">
                <Square className="size-3.5" aria-hidden /> {stopping ? "Stopping…" : "Stop"}
              </button>
            ) : null}
            <button type="submit" disabled={!canSend} aria-label="Send" className="inline-flex size-9 items-center justify-center rounded-full bg-gradient-to-b from-brand-400 via-brand-500 to-brand-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_20px_-10px_rgba(104,56,239,0.9)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-40 disabled:shadow-none">
              {busy ? <Spinner className="size-4" /> : <ArrowUp className="size-4" aria-hidden />}
            </button>
          </div>
        </div>
      </form>
      {error ? (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
        Answers are written by AI and can be wrong. Actions show what really happened, with links to the records.
        {usage ? ` ${usage.answers} of ${usage.allowance} answers used this month.` : ""}
      </p>
    </div>
  );
}
