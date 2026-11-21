"use client";

/**
 * A client's own page: /app/clients/<id>/<tab>. The header says who the client is and what to do next;
 * six tabs, each at its own address, hold the depth. The page offers the client to Company Chat as
 * context, so a question asked from here is about this client, with the asker's own permissions.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { useChat, useOfferChatContext } from "@/components/app/chat/chat-context";
import { useCompany } from "@/components/app/company";
import { FormError, useRun, SelectInput } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { NewVisitForm } from "@/components/app/screens/forms";
import { ArrowLeft, Mail, MessageSquareText, Phone } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clientPath, CLIENTS_PATH, TABS, type TabId } from "@/lib/app/clients";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CategoryChips, ClientMark, EmptyState, RelationshipBadge } from "./bits";
import { BillingTab } from "./billing";
import { ConversationsTab } from "./conversations";
import { DocumentsTab } from "./documents";
import { ArchiveForm, EditClientForm, RelationshipForm } from "./edit";
import { ActionMenu } from "./menu";
import { OverviewTab } from "./overview";
import { PropertiesTab } from "./properties";
import { ServicesTab } from "./services";
import { directoryHref } from "./state";

export type Profile = NonNullable<ReturnType<typeof useQuery<typeof api.clients.profile>>>;
type Dialog = "edit" | "relationship" | "archive" | "book" | null;

const noSubscription = () => () => undefined;

export function ClientProfileScreen({ customerId, tab, propertyId }: { customerId: string; tab: TabId; propertyId: string | null }) {
  const { companyId } = useCompany();
  const profile = useQuery(api.clients.profile, { companyId, customerId: customerId as Id<"customers"> });
  const back = useSyncExternalStore(noSubscription, directoryHref, () => CLIENTS_PATH);
  useOfferChatContext(profile ? [{ table: "customers", id: profile.id }, ...(propertyId ? [{ table: "properties" as const, id: propertyId }] : [])] : null);
  return (
    <div className="grid gap-5">
      <Link href={back} className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
        <ArrowLeft className="size-4" aria-hidden />
        Clients
      </Link>
      {profile === undefined ? (
        <div className="grid gap-4" aria-busy="true" aria-label="Loading the client">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : (
        <ClientBody profile={profile} tab={tab} propertyId={propertyId} />
      )}
    </div>
  );
}

function ClientBody({ profile, tab, propertyId }: { profile: Profile; tab: TabId; propertyId: string | null }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const router = useRouter();
  return (
    <>
      <ProfileHeader profile={profile} onDialog={setDialog} />
      <TabNav customerId={profile.id} active={tab} canSeeBilling={profile.canSeeBilling} onPick={(next) => router.push(clientPath(profile.id, next))} />
      <TabBody profile={profile} tab={tab} propertyId={propertyId} onBook={() => setDialog("book")} />
      <Dialogs profile={profile} dialog={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

export function TabBody({ profile, tab, propertyId, onBook, compact }: { profile: Profile; tab: TabId; propertyId: string | null; onBook: () => void; compact?: boolean }) {
  switch (tab) {
    case "overview":
      return <OverviewTab profile={profile} onBook={onBook} compact={compact} />;
    case "properties":
      return <PropertiesTab profile={profile} propertyId={propertyId} />;
    case "services":
      return <ServicesTab profile={profile} />;
    case "conversations":
      return <ConversationsTab profile={profile} />;
    case "documents":
      return <DocumentsTab profile={profile} />;
    case "billing":
      return profile.canSeeBilling ? <BillingTab profile={profile} /> : <EmptyState title="Billing is the Owner's">Invoices, payments and credits are in Finance, which only the Owner can open. Ask the Owner if you need something about this client&apos;s billing.</EmptyState>;
  }
}

/** The tabs as links, each at its own address. On a phone they become one menu instead of a squeezed row. */
export function TabNav({ customerId, active, canSeeBilling, onPick }: { customerId: string; active: TabId; canSeeBilling: boolean; onPick: (tab: TabId) => void }) {
  return (
    <>
      <label className="grid gap-1 text-sm sm:hidden">
        <span className="sr-only">Section</span>
        <SelectInput value={active} onChange={(event) => onPick(event.target.value as TabId)} className="min-h-10 rounded-lg border border-border bg-card px-3 text-strong">
          {TABS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
              {t.id === "billing" && !canSeeBilling ? " (Owner only)" : ""}
            </option>
          ))}
        </SelectInput>
      </label>
      <nav aria-label="Client sections" className="hidden border-b border-border sm:block">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <li key={t.id}>
              <Link href={clientPath(customerId, t.id)} aria-current={active === t.id ? "page" : undefined} className={cn("block border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-brand-500/50", active === t.id ? "border-brand-500 text-strong" : "border-transparent text-muted-foreground hover:text-strong")}>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

/** Who the client is, the one most useful next action, and everything else behind "More". */
export function ProfileHeader({ profile, onDialog, compact }: { profile: Profile; onDialog: (dialog: Dialog) => void; compact?: boolean }) {
  const { companyId } = useCompany();
  const chat = useChat();
  const restore = useMutation(api.clients.restore);
  const { busy, error, run } = useRun();
  const router = useRouter();
  const primary = profile.contacts.find((c) => c.roles.includes("primary"));
  const archived = profile.status === "archived";
  const activeProperties = profile.properties.filter((p) => p.status === "active");
  const action = archived
    ? profile.canManage
      ? { label: "Restore client", run: () => void run(() => restore({ companyId, customerId: profile.id })) }
      : null
    : profile.relationship === "prospect"
      ? // A prospect is quoted and booked in Sales; booking there makes them a client on this same record.
        { label: "Quote or book in Sales", run: () => router.push(`/app/agents/sales/new?mode=booking&customer=${profile.id}`) }
      : activeProperties.length === 0
        ? { label: "Add a property", run: () => router.push(`${clientPath(profile.id, "properties")}?add=1`) }
        : { label: "Book a visit", run: () => onDialog("book") };
  return (
    <div className={cn("flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between", compact && "border-0 bg-transparent p-0 sm:p-0")}>
      <div className="flex min-w-0 items-start gap-4">
        <ClientMark name={profile.name} type={profile.type} size="lg" />
        <div className="grid min-w-0 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className={cn("font-heading tracking-tight text-strong", compact ? "text-lg" : "text-2xl")}>{profile.name}</h1>
            <RelationshipBadge relationship={profile.relationship} />
            {archived ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-strong">Archived</span> : null}
          </div>
          <CategoryChips labels={profile.categories.map((c) => c.label)} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {primary ? <span className="text-strong">{primary.name !== profile.name ? primary.name : "Primary contact"}</span> : <span className="text-warning-foreground">No primary contact</span>}
            {primary?.phone ? (
              <a href={`tel:${primary.phone}`} className="inline-flex items-center gap-1 text-strong hover:underline">
                <Phone aria-hidden className="size-3.5 text-muted-foreground" />
                {primary.phone}
              </a>
            ) : null}
            {primary?.email ? (
              <a href={`mailto:${primary.email}`} className="inline-flex items-center gap-1 break-all text-strong hover:underline">
                <Mail aria-hidden className="size-3.5 text-muted-foreground" />
                {primary.email}
              </a>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Account owner: {profile.owner ? <span className="text-strong">{profile.owner.name}</span> : "not assigned"}
            {profile.conversationHeld ? ` · ${profile.conversationHeld.by} is handling conversations` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {action ? (
          <Button variant="primary" size="sm" loading={busy} onClick={action.run}>
            {action.label}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => chat.openPanel(null)} title="Opens Company Chat with this client attached. Chat works with your permissions.">
          <MessageSquareText aria-hidden /> Open in Company Chat
        </Button>
        <ActionMenu
          label="More actions"
          className="h-8 border border-border"
          actions={[
            { label: "Edit details", onSelect: () => onDialog("edit") },
            { label: "Change relationship", onSelect: () => onDialog("relationship"), disabled: archived },
            ...(action?.label !== "Book a visit" && activeProperties.length ? [{ label: "Book a visit", onSelect: () => onDialog("book") }] : []),
            { label: "Booking in Sales", href: `/app/agents/sales/new?mode=booking&customer=${profile.id}` },
            { label: "Proposal in Sales", href: `/app/agents/sales/new?mode=proposal&customer=${profile.id}` },
            { label: "Agreement only", href: `/app/agreements/new?mode=selestial&customer=${profile.id}` },
            ...(profile.canManage && !archived ? [{ label: "Archive client", onSelect: () => onDialog("archive"), danger: true }] : []),
          ]}
        />
        <FormError message={error} />
      </div>
    </div>
  );
}

export function Dialogs({ profile, dialog, onClose }: { profile: Profile; dialog: Dialog; onClose: () => void }) {
  return (
    <>
      <Modal open={dialog === "edit"} onClose={onClose} title={`Edit ${profile.name}`} description="Contacts are edited on the Overview.">
        <EditClientForm profile={profile} onDone={onClose} />
      </Modal>
      <Modal open={dialog === "relationship"} onClose={onClose} title="Relationship" description="Separate from plans, visits, payments and sales stages. Changing it changes none of those.">
        <RelationshipForm profile={profile} onDone={onClose} />
      </Modal>
      <Modal open={dialog === "archive"} onClose={onClose} title={`Archive ${profile.name}`} description="The client leaves the directory's views and keeps every record.">
        <ArchiveForm profile={profile} onDone={onClose} />
      </Modal>
      <Modal open={dialog === "book"} onClose={onClose} title="Book a visit" description="Priced from Services & Pricing. Dispatch starts staffing it once it is booked.">
        <NewVisitForm initial={{ customerId: profile.id, propertyId: profile.properties.find((p) => p.status === "active")?.id }} onDone={onClose} />
      </Modal>
    </>
  );
}
