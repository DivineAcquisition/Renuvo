"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, messageOf, SelectInput } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { CheckCircle2, Download, FileImage, Hand, Lock, Palette, RotateCcw, Sparkles, Upload, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type Asset = { assetId: string; kind: "image" | "video" | "logo"; origin: "original" | "composed" | "generated"; realWork: boolean; label: string; contentType: string; url: string | null; marketingPermission: { at: number; note: string } | null; generation: { model: string; provider: string; prompt: string; provenance: string; jobId: string } | null; sources: string[]; selectedFor: string[]; createdAt: number };

const TABS = ["Library", "Compose", "Generate", "Jobs"] as const;
type Tab = (typeof TABS)[number];

/** How an asset came to be, in words, on every card. Real work and generated work never look alike. */
function Provenance({ asset }: { asset: Asset }) {
  if (asset.origin === "generated") return <span className="rounded-full border border-brand-500/40 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-300">AI generated · {asset.generation?.model}</span>;
  if (asset.origin === "composed") return <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", asset.realWork ? "border-success/40 bg-success/10 text-success-foreground" : "border-border bg-muted text-muted-foreground")}>{asset.realWork ? "Composed from real photos" : "Composed"}</span>;
  if (asset.kind === "logo") return <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Logo</span>;
  return <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success-foreground">Real {asset.kind === "video" ? "footage" : "job photo"}</span>;
}

function Meter({ label, used, reserved, limit }: { label: string; used: number; reserved: number; limit: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
      {label}: <span className="font-semibold text-strong tabular-nums">{used + reserved}</span> of {limit} this month
    </span>
  );
}

function useUpload() {
  const { companyId } = useCompany();
  const uploadUrl = useMutation(api.creative.uploadUrl);
  return async (file: Blob, type: string) => {
    const url = await uploadUrl({ companyId });
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": type }, body: file });
    if (!response.ok) throw new Error("The upload did not finish.");
    return ((await response.json()) as { storageId: string }).storageId as Id<"_storage">;
  };
}

function Library({ assets, canSpend, onCompose }: { assets: Asset[]; canSpend: boolean; onCompose: (assetId: string) => void }) {
  const { companyId } = useCompany();
  const upload = useUpload();
  const register = useMutation(api.creative.register);
  const grant = useMutation(api.creative.grantMarketingPermission);
  const archive = useMutation(api.creative.archive);
  const importPhotos = useMutation(api.creative.importJobPhotos);
  const select = useMutation(api.creative.selectForCampaign);
  const drafts = useQuery(api.chatArtifacts.list, { companyId, paginationOpts: { numItems: 50, cursor: null } });
  const [now] = useState(() => Date.now());
  const visits = useQuery(api.jobs.list, { companyId, from: now - 90 * 86_400_000, to: now + 86_400_000, status: "completed" });
  const [kind, setKind] = useState<"image" | "video" | "logo">("image");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const run = async (key: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (done) setNotice(done);
    } catch (caught) {
      setError(caught instanceof Error && !("data" in (caught as object)) ? caught.message : messageOf(caught));
    } finally {
      setBusy(null);
    }
  };
  const campaigns = (drafts?.page ?? []).filter((row) => row.kind === "campaign" || row.kind === "plan" || row.kind === "proposal");
  return (
    <div className="grid gap-4">
      <Panel>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs font-medium text-strong">
            Add
            <SelectInput value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
              <option value="image">A photo of real work</option>
              <option value="video">Real job footage</option>
              <option value="logo">A logo or brand image</option>
            </SelectInput>
          </label>
          <Button variant="outline" loading={busy === "upload"} onClick={() => file.current?.click()}>
            <Upload className="size-4" aria-hidden /> Upload
          </Button>
          <input
            ref={file}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            accept={kind === "video" ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp"}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (!chosen) return;
              void run("upload", async () => {
                const storageId = await upload(chosen, chosen.type);
                await register({ companyId, storageId, label: chosen.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Upload", kind });
              }, "Uploaded. Real work stays exactly as it was uploaded.");
            }}
          />
          <label className="ml-auto grid gap-1 text-xs font-medium text-strong">
            Bring in a finished visit&apos;s photos
            <SelectInput
              defaultValue=""
              onChange={(event) => {
                const jobId = event.target.value as Id<"jobs">;
                event.target.value = "";
                if (jobId) void run("import", async () => setNotice(`${(await importPhotos({ companyId, jobId })).added} photo(s) added from the visit.`));
              }}
              className="h-9 max-w-xs rounded-lg border border-border bg-card px-2 text-sm"
            >
              <option value="">{visits === undefined ? "Loading visits…" : visits.length ? "Choose a completed visit" : "No completed visits in 90 days"}</option>
              {(visits ?? []).map((visit) => (
                <option key={visit._id} value={visit._id}>
                  {new Date(visit.startsAt).toLocaleDateString()} · {visit.serviceType}
                </option>
              ))}
            </SelectInput>
          </label>
        </div>
        {notice ? (
          <p role="status" className="mt-2 text-xs text-success-foreground">
            {notice}
          </p>
        ) : null}
        <FormError message={error} />
      </Panel>
      {assets.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">No assets yet. Upload real photos, bring in a visit&apos;s photos, or generate an illustration.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {assets.map((asset) => (
            <li key={asset.assetId} className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="relative aspect-square bg-muted">
                {asset.url ? (
                  asset.kind === "video" ? (
                    <video src={asset.url} controls className="size-full object-cover" aria-label={asset.label} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- stored files, sized by the card
                    <img src={asset.url} alt={asset.label} className="size-full object-cover" />
                  )
                ) : null}
                <div className="absolute top-2 left-2">
                  <Provenance asset={asset} />
                </div>
              </div>
              <div className="grid gap-1.5 p-3 text-xs">
                <p className="truncate text-sm font-medium text-strong">{asset.label}</p>
                {asset.generation ? <p className="line-clamp-2 text-muted-foreground">“{asset.generation.prompt}”</p> : null}
                {asset.realWork && asset.origin === "original" ? (
                  asset.marketingPermission ? (
                    <p className="flex items-center gap-1 text-success-foreground">
                      <CheckCircle2 className="size-3.5" aria-hidden /> May be used in marketing
                    </p>
                  ) : canSpend ? (
                    <button
                      type="button"
                      onClick={() => {
                        const note = window.prompt("How was permission given to use this in marketing? (for example: customer agreed by email on May 3)");
                        if (note?.trim()) void run(`grant-${asset.assetId}`, () => grant({ companyId, assetId: asset.assetId, note }), "Permission recorded.");
                      }}
                      className="flex items-center gap-1 text-left font-medium text-warning-foreground underline-offset-2 hover:underline"
                    >
                      <Hand className="size-3.5" aria-hidden /> Record permission to use in marketing
                    </button>
                  ) : (
                    <p className="flex items-center gap-1 text-muted-foreground">
                      <Lock className="size-3.5" aria-hidden /> No marketing permission yet
                    </p>
                  )
                ) : null}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {asset.kind !== "video" ? (
                    <Button size="xs" variant="outline" onClick={() => onCompose(asset.assetId)}>
                      Compose
                    </Button>
                  ) : null}
                  {asset.url ? (
                    <a href={asset.url} download className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-strong hover:border-brand-500/40 sm:h-6">
                      <Download className="size-3" aria-hidden /> Export
                    </a>
                  ) : null}
                  {canSpend && campaigns.length ? (
                    <SelectInput
                      aria-label="Choose for a campaign draft"
                      defaultValue=""
                      onChange={(event) => {
                        const artifactId = event.target.value;
                        event.target.value = "";
                        if (artifactId) void run(`select-${asset.assetId}`, () => select({ companyId, assetId: asset.assetId, artifactId }), "Chosen for the campaign draft. Nothing is published.");
                      }}
                      className="h-7 max-w-[9rem] rounded-md border border-border bg-card px-1 text-xs sm:h-6"
                    >
                      <option value="">{asset.selectedFor.length ? `In ${asset.selectedFor.length} draft(s)` : "Use in a draft…"}</option>
                      {campaigns.map((draft) => (
                        <option key={draft.artifactId} value={draft.artifactId}>
                          {draft.title}
                        </option>
                      ))}
                    </SelectInput>
                  ) : null}
                  {canSpend ? (
                    <button type="button" aria-label={`Archive ${asset.label}`} onClick={() => void run(`archive-${asset.assetId}`, () => archive({ companyId, assetId: asset.assetId }))} className="ml-auto text-muted-foreground hover:text-strong">
                      <X className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Real-job creatives, composed by code in the browser. The original photos are drawn, never changed. */
function Composer({ assets, initial }: { assets: Asset[]; initial: string | null }) {
  const { companyId } = useCompany();
  const upload = useUpload();
  const register = useMutation(api.creative.register);
  const images = assets.filter((asset) => asset.kind !== "video" && asset.url);
  const [before, setBefore] = useState<string>(initial ?? "");
  const [after, setAfter] = useState<string>("");
  const [logo, setLogo] = useState<string>("");
  const [caption, setCaption] = useState("Before and after: a real clean by our team");
  const [offer, setOffer] = useState("");
  const [cta, setCta] = useState("Book your clean today");
  const [format, setFormat] = useState<"1080x1080" | "1200x628" | "1080x1920">("1080x1080");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const chosen = [before, after, logo].filter(Boolean).map((id) => images.find((asset) => asset.assetId === id)).filter((asset): asset is Asset => Boolean(asset));
  const blocked = chosen.find((asset) => asset.realWork && asset.origin === "original" && !asset.marketingPermission);
  const [width, height] = format.split("x").map(Number);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const context = target.getContext("2d");
    if (!context) return;
    let cancelled = false;
    const load = (url: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("An image could not be loaded for composing."));
        image.src = url;
      });
    // Crops to fill a box without stretching: the photo's content is shown as it is, only framed.
    const cover = (image: HTMLImageElement, x: number, y: number, w: number, h: number) => {
      const scale = Math.max(w / image.width, h / image.height);
      const sw = w / scale;
      const sh = h / scale;
      context.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
    };
    (async () => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      const band = Math.round(height * 0.22);
      const tall = height > width;
      const panelH = height - band;
      const one = images.find((asset) => asset.assetId === before);
      const two = images.find((asset) => asset.assetId === after);
      const brand = images.find((asset) => asset.assetId === logo);
      try {
        const [a, b, c] = await Promise.all([one?.url ? load(one.url) : null, two?.url ? load(two.url) : null, brand?.url ? load(brand.url) : null]);
        if (cancelled) return;
        if (a && b) {
          if (tall) {
            cover(a, 0, 0, width, panelH / 2);
            cover(b, 0, panelH / 2, width, panelH / 2);
          } else {
            cover(a, 0, 0, width / 2, panelH);
            cover(b, width / 2, 0, width / 2, panelH);
          }
        } else if (a || b) cover((a ?? b)!, 0, 0, width, panelH);
        context.font = `600 ${Math.round(width * 0.03)}px Inter, sans-serif`;
        context.fillStyle = "rgba(0,0,0,0.6)";
        const label = (text: string, x: number, y: number) => {
          const pad = 12;
          const metrics = context.measureText(text);
          context.fillRect(x, y, metrics.width + pad * 2, Math.round(width * 0.045));
          context.fillStyle = "#ffffff";
          context.fillText(text, x + pad, y + Math.round(width * 0.033));
          context.fillStyle = "rgba(0,0,0,0.6)";
        };
        if (a && b) {
          label("BEFORE", 16, 16);
          label("AFTER", tall ? 16 : width / 2 + 16, tall ? panelH / 2 + 16 : 16);
        }
        context.fillStyle = "#1b0e45";
        context.fillRect(0, panelH, width, band);
        context.fillStyle = "#ffffff";
        context.font = `700 ${Math.round(width * 0.04)}px Inter, sans-serif`;
        context.fillText(caption.slice(0, 80), 32, panelH + Math.round(band * 0.38), width - 64 - (c ? band : 0));
        context.font = `500 ${Math.round(width * 0.03)}px Inter, sans-serif`;
        context.fillStyle = "#cfc2ff";
        context.fillText([offer, cta].filter(Boolean).join(" · ").slice(0, 100), 32, panelH + Math.round(band * 0.72), width - 64 - (c ? band : 0));
        if (c) {
          const size = band - 32;
          context.drawImage(c, width - size - 16, panelH + 16, size, size);
        }
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The preview could not be drawn.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [before, after, logo, caption, offer, cta, width, height, images]);

  const save = () => {
    const target = canvas.current;
    if (!target || chosen.length === 0) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    target.toBlob(async (blob) => {
      try {
        if (!blob) throw new Error("The composition could not be saved from this browser.");
        const storageId = await upload(blob, "image/png");
        await register({ companyId, storageId, label: caption.slice(0, 120) || "Composition", kind: "image", composedFrom: chosen.map((asset) => asset.assetId), layout: JSON.stringify({ format, caption, offer, cta, before, after, logo }) });
        setSaved("Saved to the library. The original photos are unchanged.");
      } catch (caught) {
        setError(caught instanceof Error && !("data" in (caught as object)) ? caught.message : messageOf(caught));
      } finally {
        setBusy(false);
      }
    }, "image/png");
  };

  const picker = (label: string, value: string, set: (value: string) => void) => (
    <label className="grid gap-1 text-xs font-medium text-strong">
      {label}
      <SelectInput value={value} onChange={(event) => set(event.target.value)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
        <option value="">None</option>
        {images.map((asset) => (
          <option key={asset.assetId} value={asset.assetId}>
            {asset.label} ({asset.origin === "generated" ? "AI generated" : asset.realWork ? "real" : asset.kind})
          </option>
        ))}
      </SelectInput>
    </label>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <Panel title="Compose a real-job creative">
        <div className="grid gap-3">
          {picker("Before", before, setBefore)}
          {picker("After", after, setAfter)}
          {picker("Logo (optional)", logo, setLogo)}
          <label className="grid gap-1 text-xs font-medium text-strong">
            Caption
            <input value={caption} maxLength={80} onChange={(event) => setCaption(event.target.value)} className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-strong">
            Offer (exactly as it should read)
            <input value={offer} maxLength={60} onChange={(event) => setOffer(event.target.value)} placeholder="e.g. $40 off your first deep clean" className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-strong">
            Call to action
            <input value={cta} maxLength={40} onChange={(event) => setCta(event.target.value)} className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-strong">
            Format
            <SelectInput value={format} onChange={(event) => setFormat(event.target.value as typeof format)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
              <option value="1080x1080">Square 1080×1080</option>
              <option value="1200x628">Link ad 1200×628</option>
              <option value="1080x1920">Story 1080×1920</option>
            </SelectInput>
          </label>
          {blocked ? <p className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">“{blocked.label}” is a real job photo without marketing permission. Record permission in the Library first.</p> : null}
          {chosen.some((asset) => asset.origin === "generated") && chosen.some((asset) => asset.realWork) ? <p className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">This mixes real photos with an AI-generated image. Do not present it as a real before and after.</p> : null}
          <Button variant="gradient" loading={busy} disabled={chosen.length === 0 || Boolean(blocked)} onClick={save}>
            Save composition
          </Button>
          {saved ? (
            <p role="status" className="text-xs text-success-foreground">
              {saved}
            </p>
          ) : null}
          <FormError message={error} />
        </div>
      </Panel>
      <Panel title="Preview">
        <canvas ref={canvas} width={width} height={height} className="mx-auto block h-auto max-h-[70vh] w-auto max-w-full rounded-xl border border-border" aria-label="Composition preview" />
        <p className="mt-2 text-xs text-muted-foreground">Photos are framed and cropped to fit, never retouched. The text is drawn exactly as typed.</p>
      </Panel>
    </div>
  );
}

function Generator({ assets, allowance }: { assets: Asset[]; allowance: { images: { used: number; reserved: number; limit: number }; videos: { used: number; reserved: number; limit: number }; imageGeneration: boolean; videoGeneration: boolean; canSpend: boolean } }) {
  const { companyId } = useCompany();
  const generate = useMutation(api.creative.generate);
  const [kind, setKind] = useState<"image_generate" | "image_edit" | "video_generate">("image_generate");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<"1024x1024" | "1536x1024" | "1024x1536">("1024x1024");
  const [count, setCount] = useState(1);
  const [fast, setFast] = useState(false);
  const [aspect, setAspect] = useState<"16:9" | "9:16">("9:16");
  const [duration, setDuration] = useState(6);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const editable = assets.filter((asset) => asset.kind !== "video" && !asset.realWork);
  const isVideo = kind === "video_generate";
  const off = isVideo ? !allowance.videoGeneration : !allowance.imageGeneration;
  // The exact credits for this exact setup, before anything is generated.
  const estimate = useQuery(api.billingUsage.estimate, {
    companyId,
    task: isVideo ? "video_generation" : kind === "image_edit" ? "image_edit" : "image_generation",
    units: isVideo || kind === "image_edit" ? 1 : count,
    ...(isVideo ? { durationSeconds: duration } : { size, fast: kind === "image_generate" ? fast : undefined }),
  });
  return (
    <Panel title="Generate an illustration or a promotional video">
      <form
        className="grid max-w-2xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          setDone(null);
          generate({ companyId, kind, prompt, sources: source ? [source] : [], params: isVideo ? { aspectRatio: aspect, durationSeconds: duration } : { size, n: kind === "image_edit" ? 1 : count, fast: kind === "image_generate" ? fast : undefined } })
            .then(() => setDone("Started. It appears under Jobs and then in the Library when the provider finishes. You can leave this page."))
            .catch((caught: unknown) => setError(messageOf(caught)))
            .finally(() => setBusy(false));
        }}
      >
        <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Generated media is labelled as AI generated everywhere it appears and is never real before/after evidence. Real job photos cannot be sent for generation or editing; compose them instead.</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What to make">
          {(
            [
              ["image_generate", "New image"],
              ["image_edit", "Edit an image"],
              ["video_generate", "Video"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={kind === value} onClick={() => setKind(value)} className={cn("h-8 rounded-full border px-3 text-xs font-medium", kind === value ? "border-brand-500/40 bg-brand-500/10 text-brand-300" : "border-border text-muted-foreground hover:text-strong")}>
              {label}
            </button>
          ))}
        </div>
        <label className="grid gap-1 text-xs font-medium text-strong">
          Prompt
          <textarea value={prompt} maxLength={4000} rows={4} onChange={(event) => setPrompt(event.target.value)} placeholder={isVideo ? "A bright, tidy living room in morning light, slow camera pan, no people" : "A friendly illustration of a sparkling kitchen, flat style, brand purple accents"} className="rounded-xl border border-border bg-card p-3 text-sm" />
        </label>
        {kind === "image_edit" || isVideo ? (
          <label className="grid gap-1 text-xs font-medium text-strong">
            {isVideo ? "Start from an image (optional)" : "Image to edit"}
            <SelectInput value={source} onChange={(event) => setSource(event.target.value)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
              <option value="">{isVideo ? "No image" : "Choose a generated image or logo"}</option>
              {editable.map((asset) => (
                <option key={asset.assetId} value={asset.assetId}>
                  {asset.label}
                </option>
              ))}
            </SelectInput>
          </label>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {isVideo ? (
            <>
              <label className="grid gap-1 text-xs font-medium text-strong">
                Shape
                <SelectInput value={aspect} onChange={(event) => setAspect(event.target.value as typeof aspect)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
                  <option value="9:16">Vertical 9:16</option>
                  <option value="16:9">Wide 16:9</option>
                </SelectInput>
              </label>
              <label className="grid gap-1 text-xs font-medium text-strong">
                Length
                <SelectInput value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
                  {[4, 6, 8, 10].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </SelectInput>
              </label>
            </>
          ) : (
            <>
              <label className="grid gap-1 text-xs font-medium text-strong">
                Size
                <SelectInput value={size} onChange={(event) => setSize(event.target.value as typeof size)} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
                  <option value="1024x1024">Square</option>
                  <option value="1536x1024">Landscape</option>
                  <option value="1024x1536">Portrait</option>
                </SelectInput>
              </label>
              {kind === "image_generate" ? (
                <>
                  <label className="grid gap-1 text-xs font-medium text-strong">
                    Variants
                    <SelectInput value={count} onChange={(event) => setCount(Number(event.target.value))} className="h-9 rounded-lg border border-border bg-card px-2 text-sm">
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </SelectInput>
                  </label>
                  <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-strong">
                    <input type="checkbox" checked={fast} onChange={(event) => setFast(event.target.checked)} className="size-4 accent-[#6838ef]" /> Fast variants
                  </label>
                </>
              ) : null}
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="gradient" loading={busy} disabled={!prompt.trim() || !allowance.canSpend || off || (kind === "image_edit" && !source) || estimate?.ok === false}>
            <Sparkles className="size-4" aria-hidden /> Generate
          </Button>
          {estimate ? (
            <span role="status" className={cn("text-xs font-medium", estimate.ok ? "text-strong" : "text-warning-foreground")}>
              {estimate.ok ? `Uses exactly ${estimate.credits.toLocaleString("en-US")} Selestial Credits.` : estimate.message}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {isVideo ? `Uses 1 of ${allowance.videos.limit} videos this month.` : `Uses ${kind === "image_edit" ? 1 : count} of ${allowance.images.limit} images this month.`}
          </span>
        </div>
        {!allowance.canSpend ? <p className="text-xs text-muted-foreground">Owners and Managers start generations.</p> : null}
        {off ? <p className="text-xs text-warning-foreground">The Owner has switched this off in Settings › AI &amp; usage.</p> : null}
        {done ? (
          <p role="status" className="text-xs text-success-foreground">
            {done}
          </p>
        ) : null}
        <FormError message={error} />
      </form>
    </Panel>
  );
}

const JOB_WORDS: Record<string, string> = { queued: "Waiting to start", running: "Working", completed: "Done", failed: "Failed", uncertain: "Unclear: not sent again", cancel_requested: "Stopping", cancelled: "Stopped" };

function Jobs({ assets, canSpend }: { assets: Asset[]; canSpend: boolean }) {
  const { companyId } = useCompany();
  const jobs = useQuery(api.creative.jobs, { companyId });
  const cancel = useMutation(api.creative.cancel);
  const regenerate = useMutation(api.creative.regenerate);
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(assets.map((asset) => [asset.assetId, asset])), [assets]);
  if (!jobs) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (jobs.length === 0) return <p className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">No generations yet.</p>;
  return (
    <div className="grid gap-3">
      <FormError message={error} />
      {jobs.map((job) => (
        <section key={job.jobId} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            {job.state === "running" || job.state === "queued" || job.state === "cancel_requested" ? <Spinner className="size-4 text-brand-300" /> : job.state === "completed" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <X className="size-4 text-muted-foreground" aria-hidden />}
            <span className={cn("text-sm font-semibold text-strong", job.state === "running" && "live-shimmer-text")}>{JOB_WORDS[job.state] ?? job.state}</span>
            <span className="text-xs text-muted-foreground">
              {job.kind === "video_generate" ? "Video" : job.kind === "image_edit" ? "Image edit" : "Image"} · {job.model} · prompt v{job.promptVersion}
            </span>
            <span className="ml-auto flex gap-1.5">
              {canSpend && job.canCancel ? (
                <Button size="xs" variant="ghost" onClick={() => cancel({ companyId, jobId: job.jobId as Id<"mediaJobs"> }).catch((caught: unknown) => setError(messageOf(caught)))}>
                  Stop
                </Button>
              ) : null}
              {canSpend && (job.state === "completed" || job.state === "failed") ? (
                <Button size="xs" variant="outline" onClick={() => regenerate({ companyId, jobId: job.jobId as Id<"mediaJobs"> }).catch((caught: unknown) => setError(messageOf(caught)))}>
                  <RotateCcw className="size-3" aria-hidden /> Make another
                </Button>
              ) : null}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">“{job.prompt}”</p>
          {job.error ? <p className="mt-1.5 text-xs text-strong">{job.error}</p> : null}
          {job.outputs.length ? (
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Variants to compare">
              {job.outputs.map((id) => {
                const asset = byId.get(id);
                return (
                  <li key={id} className="overflow-hidden rounded-xl border border-border">
                    {asset?.url ? (
                      asset.kind === "video" ? (
                        <video src={asset.url} controls className="aspect-square w-full object-cover" aria-label={asset.label} />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- stored files
                        <img src={asset.url} alt={asset.label} className="aspect-square w-full object-cover" />
                      )
                    ) : (
                      <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">Archived</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/**
 * Creative Studio: real-job creatives composed from the company's own photos, and generated media,
 * kept visibly apart. Under Marketing › Content & Creative.
 */
export function CreativeStudio() {
  const { companyId } = useCompany();
  const allowance = useQuery(api.creative.allowance, { companyId });
  const library = usePaginatedQuery(api.creative.library, { companyId }, { initialNumItems: 48 });
  const [tab, setTab] = useState<Tab>("Library");
  const [composeFrom, setComposeFrom] = useState<string | null>(null);
  const assets = library.results as Asset[];
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Creative Studio"
        lead="Make marketing creatives from your real work, exactly as it is, and generate illustrations or short videos that are always labelled as generated. Nothing here publishes or spends on ads."
        actions={
          allowance ? (
            <>
              <Meter label="Images" used={allowance.images.used} reserved={allowance.images.reserved} limit={allowance.images.limit} />
              <Meter label="Videos" used={allowance.videos.used} reserved={allowance.videos.reserved} limit={allowance.videos.limit} />
            </>
          ) : null
        }
      />
      <div role="tablist" aria-label="Creative Studio" className="flex w-fit flex-wrap gap-0.5 rounded-xl border border-border bg-muted p-0.5">
        {TABS.map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-sm font-semibold", tab === value ? "bg-card text-strong shadow-sm" : "text-muted-foreground hover:text-strong")}>
            {value === "Library" ? <FileImage className="size-4" aria-hidden /> : value === "Compose" ? <Palette className="size-4" aria-hidden /> : value === "Generate" ? <Sparkles className="size-4" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
            {value}
          </button>
        ))}
      </div>
      {tab === "Library" ? (
        <>
          <Library
            assets={assets}
            canSpend={allowance?.canSpend ?? false}
            onCompose={(assetId) => {
              setComposeFrom(assetId);
              setTab("Compose");
            }}
          />
          {library.status === "CanLoadMore" ? (
            <Button variant="outline" className="justify-self-center" onClick={() => library.loadMore(48)}>
              Show more
            </Button>
          ) : null}
        </>
      ) : null}
      {tab === "Compose" ? <Composer key={composeFrom ?? "none"} assets={assets} initial={composeFrom} /> : null}
      {tab === "Generate" && allowance ? <Generator assets={assets} allowance={allowance} /> : null}
      {tab === "Jobs" ? <Jobs assets={assets} canSpend={allowance?.canSpend ?? false} /> : null}
    </div>
  );
}
