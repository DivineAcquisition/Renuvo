/**
 * Clients & Properties in Chat. Chat reads a client the way the profile shows it to this person, and can
 * draft a message to a client; it never sends one. A draft opens in the client's Conversations, where a
 * person sees the recipient, the address and what the sending policy says, edits it and sends it.
 */
import type { Id } from "../../_generated/dataModel";
import { sendCheck, targetsOf } from "../clients/conversations";
import type { ChatTool, Outcome } from "./tools";

const refused = (why: string): Outcome => ({ status: "refused", why });

export const CLIENT_TOOLS: ChatTool[] = [
  {
    name: "draft_client_message",
    label: "Drafting a message to a client",
    description:
      "Draft a text or email to a client for a person to review and send from the client's Conversations. It never sends anything. Returns whether the client's own phone or email could receive it now, in the sending policy's words, and a link that opens the draft. Write only what the records support; never promise a time, price or change that is not booked.",
    kind: "draft",
    minimumRole: "office",
    input: {
      type: "object",
      properties: {
        customerId: { type: "string", description: "The client's id.", max: 64 },
        channel: { type: "string", enum: ["sms", "email"] },
        body: { type: "string", max: 1200 },
        subject: { type: "string", optional: true, max: 200 },
      },
    },
    run: async (ctx, args) => {
      const id = ctx.db.normalizeId("customers", args.customerId as string);
      const customer = id ? await ctx.db.get(id) : null;
      if (!customer || customer.companyId !== ctx.company._id) return refused("No such client in this company.");
      if (customer.status === "archived") return refused("This client is archived. Restore them before messaging them.");
      const channel = args.channel as "sms" | "email";
      const own = (await targetsOf(ctx, customer))[0];
      const check = await sendCheck(ctx, customer, own, channel);
      const params = new URLSearchParams({ draft: String(args.body), channel });
      if (channel === "email" && args.subject) params.set("subject", String(args.subject));
      const href = `/app/clients/${customer._id as Id<"customers">}/conversations?${params.toString()}`;
      return {
        status: "done",
        summary: `Drafted a ${channel === "sms" ? "text" : "email"} to ${customer.name}. Nothing was sent.`,
        data: {
          to: customer.name,
          address: own.address[channel],
          canSendNow: check.ok,
          policy: check.ok ? null : check.words,
          next: "A person opens the link, reads and edits the draft, and sends it from Conversations.",
        },
        link: { href, label: "Review and send in Conversations" },
      };
    },
  },
];
