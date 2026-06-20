import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { getThread } from "@/lib/inbox/queries";
import { Thread } from "./Thread";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const active = await getActiveOrg();
  if (!active) return null;
  const { customer, messages } = await getThread(active.org.id, conversationId);
  if (!customer) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        href="/dashboard/inbox"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Inbox
      </Link>
      <Thread
        customerId={customer.id}
        name={customer.full_name ?? "Customer"}
        phone={customer.phone}
        sendable={!!customer.sms_sendable}
        agentPaused={!!customer.agent_paused}
        messages={messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          body: m.body,
          type: m.type,
        }))}
      />
    </div>
  );
}
