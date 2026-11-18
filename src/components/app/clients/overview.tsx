"use client";

/**
 * The first screen of a client: who they are, what was promised, what happens next, and what needs
 * attention. Every line is read from a record and names it; nothing here is a score.
 */
import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Modal } from "@/components/app/modal";
import { Plus } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { clientPath } from "@/lib/app/clients";

import { api } from "../../../../convex/_generated/api";
import { Card, when } from "./bits";
import { ContactForm } from "./edit";
import { AgentCard, AttentionCard, ContactList, NextServiceCard, PlanSummary, PropertyCard, Timeline, type ContactRow } from "./parts";
import type { Profile } from "./profile";

const CHANNEL_WORDS: Record<string, string> = { sms: "Text", email: "Email", phone: "Phone call" };
const SOURCE_WORDS: Record<string, string> = { manual: "Added by the team", google_lead: "A Google Ads lead", import: "An import", booking: "A booking" };

export function OverviewTab({ profile, onBook, compact }: { profile: Profile; onBook: () => void; compact?: boolean }) {
  const { companyId, timezone } = useCompany();
  const summary = useQuery(api.clients.summary, { companyId, customerId: profile.id });
  const [contact, setContact] = useState<ContactRow | "new" | null>(null);
  const properties = profile.properties.filter((p) => p.status === "active");
  const nextAt = (propertyId: string) => summary?.upcoming.find((v) => v.propertyId === propertyId)?.startsAt ?? null;
  return (
    <div className={compact ? "grid gap-4" : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"}>
      <div className="grid min-w-0 content-start gap-5">
        {summary === undefined ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : (
          <>
            <NextServiceCard visit={summary.nextVisit} timezone={timezone} onBook={properties.length ? onBook : undefined} />
            {summary.attention.length ? (
              <Card title="Needs attention">
                <ul className="grid gap-2">
                  {summary.attention.map((item) => (
                    <AttentionCard key={`${item.kind}-${item.ref.id}-${item.at}`} item={item} timezone={timezone} customerId={profile.id} />
                  ))}
                </ul>
              </Card>
            ) : null}
            <Card title="Selestial is handling">
              {summary.handling.length ? (
                <ul className="grid gap-2">
                  {summary.handling.map((card) => (
                    <AgentCard key={card.id} card={card} timezone={timezone} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No open work about this client. When an agent or a person takes something on, it shows here with its next step.</p>
              )}
            </Card>
            <Card
              title="Service arrangements"
              action={
                <Link href={`${clientPath(profile.id, "services")}?view=plans`} className="text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
                  All plans
                </Link>
              }
            >
              {summary.plans.length ? (
                <ul className="grid gap-2">
                  {summary.plans.map((plan) => (
                    <PlanSummary key={plan.id} plan={plan} timezone={timezone} customerId={profile.id} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No recurring plan or standing arrangement. Visits are booked one at a time.</p>
              )}
            </Card>
            {!compact ? (
              <Card title="Recent activity">
                <Timeline items={summary.activity} timezone={timezone} />
              </Card>
            ) : null}
          </>
        )}
      </div>

      <div className="grid min-w-0 content-start gap-5">
        {properties.length === 1 ? (
          <PropertyCard property={properties[0]} customerId={profile.id} nextAt={nextAt(properties[0].id)} timezone={timezone} />
        ) : properties.length > 1 ? (
          <Card
            title={`Properties (${properties.length})`}
            action={
              <Link href={clientPath(profile.id, "properties")} className="text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
                All
              </Link>
            }
          >
            <div className="grid gap-2">
              {properties.slice(0, 4).map((p) => (
                <PropertyCard key={p.id} property={p} customerId={profile.id} nextAt={nextAt(p.id)} timezone={timezone} className="p-3" />
              ))}
            </div>
          </Card>
        ) : null}
        <Card
          title="Contacts"
          action={
            <button type="button" onClick={() => setContact("new")} className="inline-flex items-center gap-1 text-sm font-medium text-brand-300 underline-offset-4 hover:underline">
              <Plus aria-hidden className="size-3.5" /> Add
            </button>
          }
        >
          {profile.contacts.length ? <ContactList contacts={profile.contacts} properties={profile.properties} onEdit={setContact} /> : <p className="text-sm text-warning-foreground">No contact yet. Add who to reach.</p>}
        </Card>
        <Card title="Preferences">
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Communication</dt>
              <dd className="text-strong">
                {profile.communication.preferredChannel ? CHANNEL_WORDS[profile.communication.preferredChannel] : "No preference recorded"}
                {profile.communication.bestTime ? `, ${profile.communication.bestTime}` : ""}
                {profile.communication.language ? ` · ${profile.communication.language}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Service</dt>
              <dd className="whitespace-pre-line text-strong">{profile.preferences ?? "Nothing recorded"}</dd>
            </div>
            {profile.privateNotes ? (
              <div className="rounded-lg bg-muted/50 px-2.5 py-2">
                <dt className="text-xs text-muted-foreground">Private notes (Owners and Managers)</dt>
                <dd className="whitespace-pre-line text-strong">{profile.privateNotes}</dd>
              </div>
            ) : null}
          </dl>
        </Card>
        <Card title="Relationship">
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Status</dt>
              <dd className="text-strong">
                {profile.relationshipWords}
                {profile.relationshipAt ? <span className="text-muted-foreground"> since {when(profile.relationshipAt, timezone)}</span> : null}
                {profile.relationshipNote ? <span className="block text-muted-foreground">{profile.relationshipNote}</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Account owner</dt>
              <dd className="text-strong">{profile.owner?.name ?? "Not assigned"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Client since</dt>
              <dd className="text-strong">
                {when(profile.createdAt, timezone)}
                {profile.source ? <span className="text-muted-foreground"> · {SOURCE_WORDS[profile.source] ?? profile.source}</span> : null}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
      <Modal open={contact !== null} onClose={() => setContact(null)} title={contact === "new" ? "Add a contact" : "Edit contact"} description="Roles say who to reach for what: billing, signing, or meeting the crew at a property.">
        <ContactForm customerId={profile.id} contact={contact === "new" ? null : contact} properties={profile.properties} onDone={() => setContact(null)} />
      </Modal>
    </div>
  );
}
