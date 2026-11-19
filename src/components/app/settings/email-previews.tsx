"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { DesktopIcon, DeviceMobileIcon, FileText, Mail, MoonIcon, SunIcon } from "@/components/icons";
import { Panel } from "@/components/app/shell";
import { cn } from "@/lib/utils";

import { PREVIEWS, type Preview } from "../../../../convex/lib/email/templates/gallery";

type Width = "desktop" | "mobile";
const noSubscription = () => () => {};
type Scheme = "light" | "dark";
type View = "email" | "text";

/**
 * Mail programs that honour dark mode apply the email's own dark rules. The preview can't change the
 * reader's setting, so it applies the same rules directly.
 */
function inScheme(html: string, scheme: Scheme): string {
  return scheme === "dark" ? html.replace("@media (prefers-color-scheme: dark){", "@media all{") : html;
}

function Toggle<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string; icon: React.ComponentType<{ className?: string }> }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-muted/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors", value === o.id ? "bg-card text-strong shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-strong")}
        >
          <o.icon className="size-3.5" />
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The email in a frame that can't run anything or go anywhere, sized to its content. */
function Frame({ html, width, title }: { html: string; width: Width; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(900);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const fit = () => {
      const doc = frame.contentDocument;
      // The body's own height: the document's would never be less than the frame it sits in.
      if (doc?.body) setHeight(Math.max(320, Math.ceil(doc.body.scrollHeight)));
    };
    frame.addEventListener("load", fit);
    if (frame.contentDocument?.readyState === "complete") fit();
    return () => frame.removeEventListener("load", fit);
  }, []);
  return (
    <div className={cn("mx-auto overflow-hidden rounded-xl border border-border bg-[#F5F4FA] shadow-sm transition-[width]", width === "desktop" ? "w-full max-w-[680px]" : "w-[390px] max-w-full")}>
      {/* No scripts and no navigation: the sandbox only lets the frame be measured. */}
      <iframe ref={ref} title={title} sandbox="allow-same-origin" srcDoc={html} className="block w-full border-0" style={{ height }} />
    </div>
  );
}

function InboxRow({ preview, subject, preheader }: { preview: Preview; subject: string; preheader: string }) {
  const sender = preview.from.replace(/\s*<[^>]+>$/, "").replace(/^"|"$/g, "");
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span aria-hidden className={cn("mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold", preview.kind === "platform" ? "bg-brand-500/10 text-brand-600" : "bg-emerald-600/10 text-emerald-700")}>
        {sender.slice(0, 1)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-semibold text-strong">{sender}</p>
          <span className="shrink-0 text-xs text-muted-foreground">9:00 AM</span>
        </div>
        <p className="truncate text-sm text-strong">{subject}</p>
        <p className="truncate text-sm text-muted-foreground">{preheader}</p>
      </div>
    </div>
  );
}

/**
 * Every email Selestial sends, shown with sample data: as the inbox lists it, then in full on a desktop
 * or a phone, in light or dark, and as the plain-text version mail programs fall back to.
 */
export function EmailPreviews() {
  const [id, setId] = useState(PREVIEWS[0].id);
  const [width, setWidth] = useState<Width>("desktop");
  const [scheme, setScheme] = useState<Scheme>("light");
  const [view, setView] = useState<View>("email");
  // Images in the previews load from this app's own address; on the server there is none yet.
  const origin = useSyncExternalStore(noSubscription, () => window.location.origin, () => null);

  const preview = PREVIEWS.find((p) => p.id === id) ?? PREVIEWS[0];
  const mail = useMemo(() => preview.render(origin), [preview, origin]);
  const groups: { label: string; kind: Preview["kind"] }[] = [
    { label: "From Selestial to your team", kind: "platform" },
    { label: "From your company, via Selestial", kind: "company" },
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      {/* On a phone, one menu instead of a long list. */}
      <label className="grid gap-1 text-sm lg:hidden">
        <span className="font-medium text-strong">Email</span>
        <select value={id} onChange={(event) => setId(event.target.value)} className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-strong">
          {groups.map((g) => (
            <optgroup key={g.kind} label={g.label}>
              {PREVIEWS.filter((p) => p.kind === g.kind).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <nav aria-label="Emails" className="hidden content-start gap-4 lg:grid">
        {groups.map((g) => (
          <div key={g.kind}>
            <p className="mb-1.5 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.label}</p>
            <ul className="grid gap-0.5">
              {PREVIEWS.filter((p) => p.kind === g.kind).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setId(p.id)}
                    aria-current={p.id === id ? "true" : undefined}
                    className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors", p.id === id ? "bg-brand-500/10 font-medium text-strong" : "text-muted-foreground hover:bg-muted hover:text-strong")}
                  >
                    <Mail className="size-4 shrink-0 opacity-70" />
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
        <Panel className="grid gap-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-strong">{preview.name}</h2>
              <p className="text-sm text-muted-foreground">{preview.when}</p>
            </div>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-500/20">Sample data</span>
          </div>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[110px_minmax(0,1fr)]">
            <dt className="text-muted-foreground">From</dt>
            <dd className="min-w-0 break-words text-strong">{preview.from}</dd>
            <dt className="text-muted-foreground">Subject</dt>
            <dd className="min-w-0 break-words text-strong">{mail.subject}</dd>
            <dt className="text-muted-foreground">Preview text</dt>
            <dd className="min-w-0 break-words text-strong">{mail.preheader}</dd>
            <dt className="text-muted-foreground">Setting</dt>
            <dd className="min-w-0 text-strong">{preview.category}</dd>
          </dl>
        </Panel>

        <InboxRow preview={preview} subject={mail.subject} preheader={mail.preheader} />

        <div className="flex flex-wrap items-center gap-2">
          <Toggle label="Version" value={view} onChange={setView} options={[{ id: "email", label: "Email", icon: Mail }, { id: "text", label: "Plain text", icon: FileText }]} />
          {view === "email" ? (
            <>
              <Toggle label="Screen" value={width} onChange={setWidth} options={[{ id: "desktop", label: "Desktop", icon: DesktopIcon }, { id: "mobile", label: "Phone", icon: DeviceMobileIcon }]} />
              <Toggle label="Appearance" value={scheme} onChange={setScheme} options={[{ id: "light", label: "Light", icon: SunIcon }, { id: "dark", label: "Dark", icon: MoonIcon }]} />
            </>
          ) : null}
        </div>

        {view === "email" ? (
          <Frame key={`${preview.id}-${width}-${scheme}-${origin}`} html={inScheme(mail.html, scheme)} width={width} title={`${preview.name} email preview`} />
        ) : (
          <pre className="max-w-[680px] overflow-x-auto rounded-xl border border-border bg-card p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap text-strong">{mail.text}</pre>
        )}
        <p className="max-w-[680px] text-xs text-muted-foreground">
          Previews use sample names and numbers. Real emails use your records at the moment they&apos;re sent, and leave out anything that isn&apos;t known. Links in previews don&apos;t go anywhere.
        </p>
      </div>
    </div>
  );
}
