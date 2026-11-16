"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { DocumentPane, GuidePanel } from "@/components/app/agreements/document";
import { Activity, Versions } from "@/components/app/agreements/history";
import { ReviewAndSignatures } from "@/components/app/agreements/review";
import { AccessBadge, LifecycleBadge, Notice, ToneBadge, WorkflowBadge } from "@/components/app/agreements/shared";
import { KeyTerms, PartiesAndLinks } from "@/components/app/agreements/terms";
import { FormError, useRun } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AGREEMENTS_ROOT, isoDay, PROVENANCE } from "@/lib/app/agreements";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { markdownToPdf } from "../../../../convex/lib/agreements/pdf";

const TABS = [
  { id: "document", label: "Document" },
  { id: "parties", label: "Parties & Linked Records" },
  { id: "terms", label: "Key Terms" },
  { id: "versions", label: "Versions & Changes" },
  { id: "review", label: "Review & Signatures" },
  { id: "activity", label: "Activity" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * One agreement, in one workspace: the same one a link from Chat, a customer, a worker or a visit opens.
 * The document sits beside its structured terms and Selestial's questions; on a phone they stack and the
 * document can go full screen.
 */
export function AgreementDetail({ agreementId }: { agreementId: string }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("document");
  const [viewing, setViewing] = useState<number | undefined>(undefined);
  const detail = useQuery(api.companyAgreements.get, { companyId, agreementId, version: viewing });
  const exporter = useMutation(api.companyAgreements.exportVersion);
  const send = useMutation(api.chat.send);
  const adopt = useMutation(api.companyAgreements.adoptConversation);
  const { busy, error, run } = useRun();

  if (detail === undefined) return <Skeleton className="h-96 rounded-2xl" />;
  const editable = detail.capabilities.canEdit && !["sent", "partially_signed", "signed"].includes(detail.workflow) && !detail.archived;
  const locked = !editable && detail.capabilities.canEdit;

  const exportPdf = () =>
    run(async () => {
      const out = await exporter({ companyId, agreementId, version: viewing ?? detail.currentVersion, format: "pdf" });
      download(markdownToPdf(out.markdown, { title: out.title, footer: out.footer }), `${out.title.replace(/[^\w.-]+/g, "-").slice(0, 60)}-v${out.version}.pdf`);
    });

  const askSelestial = () =>
    run(async () => {
      const text = `Help me finish my agreement "${detail.title}" (agreement id ${detail.id}). Read it, tell me what is still open, and ask me the next questions.`;
      const sent = await send({ companyId, text, clientKey: `agreement-${detail.id}-${Date.now()}`, page: `/app/agreements/${detail.id}` });
      await adopt({ companyId, agreementId, conversationId: sent.conversationId });
      router.push(`/app/chat/${sent.conversationId}`);
    });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={AGREEMENTS_ROOT} className="text-xs text-muted-foreground hover:underline">
            ‹ All agreements
          </Link>
          <h2 className="mt-1 font-heading text-xl tracking-tight text-strong sm:text-2xl">{detail.title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {detail.typeLabel} · version {detail.currentVersion}
            {detail.lifecycle.effectiveOn ? ` · effective ${isoDay(detail.lifecycle.effectiveOn)}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <WorkflowBadge workflow={detail.workflow} />
            <LifecycleBadge status={detail.lifecycle.status} />
            <AccessBadge access={detail.access} />
            {detail.provenance !== "unsigned" ? <ToneBadge tone="success">{PROVENANCE[detail.provenance].label}</ToneBadge> : null}
            {detail.archived ? <ToneBadge tone="neutral">Archived</ToneBadge> : null}
            {detail.readinessLabel === "specialist_review" ? <ToneBadge tone="warning" title={detail.note ?? undefined}>Needs specialist review</ToneBadge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {detail.capabilities.archiveExport ? (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void exportPdf()}>
              Download PDF
            </Button>
          ) : null}
          {detail.conversation?.id ? (
            <Link href={`/app/chat/${detail.conversation.id}`} className="inline-flex h-8 items-center rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-strong hover:bg-muted">
              Open the chat
            </Link>
          ) : detail.capabilities.canEdit ? (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void askSelestial()}>
              Ask Selestial
            </Button>
          ) : null}
        </div>
      </div>
      <FormError message={error} />
      {detail.note ? <Notice tone="warning">{detail.note}</Notice> : null}
      {locked ? <Notice>{detail.workflow === "signed" ? "A signed agreement is never edited. To change it, start an amendment or a replacement under Review & Signatures." : detail.archived ? "This agreement is archived. Restore it to edit." : "This version is out for signature, so it cannot be edited. Withdraw the request first, or wait for the signers."}</Notice> : null}
      {!detail.isCurrent ? (
        <Notice tone="warning">
          You are reading version {detail.version.version}, an earlier version.{" "}
          <button type="button" className="font-medium underline" onClick={() => setViewing(undefined)}>
            Back to the latest (version {detail.currentVersion})
          </button>
        </Notice>
      ) : null}

      <div role="tablist" aria-label="Agreement sections" className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} onClick={() => setTab(item.id)} className={cn("shrink-0 border-b-2 px-3 py-2 text-sm", tab === item.id ? "border-brand-500 font-medium text-strong" : "border-transparent text-muted-foreground hover:text-strong")}>
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "document" ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
            <DocumentPane detail={detail} editable={editable} />
            <GuidePanel detail={detail} editable={editable} />
          </div>
        ) : null}
        {tab === "parties" ? <PartiesAndLinks detail={detail} editable={editable || (detail.capabilities.canEdit && detail.workflow === "approved")} /> : null}
        {tab === "terms" ? <KeyTerms detail={detail} editable={editable} /> : null}
        {tab === "versions" ? <Versions detail={detail} onOpen={(version) => (setViewing(version === detail.currentVersion ? undefined : version), setTab("document"))} /> : null}
        {tab === "review" ? <ReviewAndSignatures detail={detail} /> : null}
        {tab === "activity" ? <Activity detail={detail} /> : null}
      </div>
    </div>
  );
}

