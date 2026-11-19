"use server";

import { ConvexHttpClient } from "convex/browser";

import { api } from "../../../convex/_generated/api";

/**
 * Turning off one kind of notice from the unsubscribe link in it. The token names the notice; the server
 * adds the secret it shares with Convex. Nothing else passes through here.
 */
export async function unsubscribeFromNotices(input: { token: string }): Promise<{ ok: true } | { ok: false; why: string }> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const secret = process.env.PUBLIC_FORM_SECRET?.trim();
  if (!url || !/^https:\/\//.test(url) || !secret) return { ok: false, why: "This can't be done from the link right now. You can change notifications in Selestial's settings." };
  try {
    return await new ConvexHttpClient(url).mutation(api.notifications.unsubscribe, { secret, token: input.token.slice(0, 200) });
  } catch {
    return { ok: false, why: "That didn't go through. Please try again, or change notifications in Selestial's settings." };
  }
}
