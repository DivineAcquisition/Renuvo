/**
 * Selestial's own model administration, for staff only. Keys live in the deployment's environment and
 * are never read back: this shows only whether each provider is connected. Staff admins switch a
 * capability on or off and record where its evaluation stands.
 */
import { v } from "convex/values";

import { staffMutation, staffQuery } from "./lib/builders";
import { capabilityValidator, evaluationValidator } from "./lib/ai/schema";
import { CHAT_MODELS, chatModelOption } from "./lib/ai/chatModels";
import { CAPABILITIES, openRouterChatModel, PROVIDER_KEYS, PROVIDER_NAMES, PROVIDERS, providerConfigured, REGISTRY, resolve } from "./lib/ai/registry";
import { userError } from "./lib/errors";
import { text } from "./lib/text";

export const models = staffQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query("aiSettings").take(100);
    const backup = openRouterChatModel();
    const chatModelRows = await ctx.db.query("chatModelSettings").take(100);
    return {
      chatModels: CHAT_MODELS.map((option) => ({
        key: option.key,
        label: option.label,
        maker: option.maker,
        route: option.route,
        model: option.entry.model,
        rates: option.entry.rates,
        cost: option.cost,
        connected: providerConfigured(option.entry.provider),
        enabled: chatModelRows.find((row) => row.key === option.key)?.enabled ?? true,
      })),
      providers: PROVIDERS.map((provider) => ({ provider, name: PROVIDER_NAMES[provider], key: PROVIDER_KEYS[provider], connected: providerConfigured(provider) })),
      openRouterChatModel: backup?.model ?? null,
      capabilities: CAPABILITIES.map((capability) => {
        const entry = REGISTRY[capability];
        const setting = settings.find((row) => row.capability === capability) ?? null;
        const resolved = resolve(capability, setting ? { enabled: setting.enabled, evaluation: setting.evaluation } : null);
        return {
          capability,
          label: entry.label,
          optional: entry.optional,
          implemented: entry.implemented,
          provider: entry.primary.provider,
          model: entry.primary.model,
          verification: entry.primary.verification,
          rates: entry.primary.rates,
          timeoutMs: entry.primary.timeoutMs,
          inputs: entry.inputs,
          outputs: entry.outputs,
          aspectRatios: entry.aspectRatios ?? null,
          durations: entry.durations ?? null,
          cancellation: entry.cancellation,
          dataNote: entry.dataNote,
          fallback: capability === "chat" ? (backup ? `openrouter:${backup.model} for Claude choices; Claude Sonnet 5.5 for other choices (outage and rate limit only)` : "none") : "none",
          setting: setting ? { enabled: setting.enabled, evaluation: setting.evaluation, note: setting.note ?? null, updatedAt: setting.updatedAt } : null,
          state: resolved.ready ? "ready" : resolved.reason,
        };
      }),
    };
  },
});

export const setCapability = staffMutation({
  args: { capability: capabilityValidator, enabled: v.boolean(), evaluation: evaluationValidator, note: v.optional(v.string()) },
  adminOnly: true,
  handler: async (ctx, args) => {
    const entry = REGISTRY[args.capability];
    if (args.enabled && !entry.implemented) throw userError(`${entry.label} has no adapter in Selestial yet, so it cannot be switched on.`);
    const existing = await ctx.db
      .query("aiSettings")
      .withIndex("by_capability", (q) => q.eq("capability", args.capability))
      .unique();
    const row = { capability: args.capability, enabled: args.enabled, evaluation: args.evaluation, note: args.note?.trim() ? text(args.note, "The note", 500) : undefined, updatedBy: ctx.staff._id, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("aiSettings", row);
    return null;
  },
});

/** Offer or withdraw one model people may choose in chat. The default model is switched with chat itself. */
export const setChatModel = staffMutation({
  args: { key: v.string(), enabled: v.boolean() },
  adminOnly: true,
  handler: async (ctx, args) => {
    const option = chatModelOption(args.key);
    if (!option) throw userError("That model is not in Selestial's list.");
    if (option.key === "claude-sonnet" && !args.enabled) throw userError("Claude Sonnet 5.5 is the default. Switch chat itself off instead.");
    const existing = await ctx.db
      .query("chatModelSettings")
      .withIndex("by_key", (q) => q.eq("key", option.key))
      .unique();
    const row = { key: option.key, enabled: args.enabled, updatedBy: ctx.staff._id, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("chatModelSettings", row);
    return null;
  },
});
