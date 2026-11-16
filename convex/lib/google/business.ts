/**
 * Google Business Profile: the accounts and locations an Owner can manage, their reviews, and replies.
 * A reply is published only after a person approved its exact text. Reviews are read and answered the
 * same whatever their rating.
 */
import { GoogleError, googleCall, type Fetch } from "./http";

const ACCOUNTS = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS = "https://mybusiness.googleapis.com/v4";
const NOTIFY = "https://mybusinessnotifications.googleapis.com/v1";

export type Account = { name: string; accountName?: string; type?: string };
export type Location = { name: string; title?: string; storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string; postalCode?: string } };
export type Review = { name: string; reviewId?: string; reviewer?: { displayName?: string; isAnonymous?: boolean }; starRating?: string; comment?: string; createTime?: string; updateTime?: string; reviewReply?: { comment?: string; updateTime?: string } };

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export const starsOf = (rating?: string) => STARS[rating ?? ""] ?? 0;

export async function accounts(token: string, fetcher?: Fetch): Promise<Account[]> {
  const body = await googleCall<{ accounts?: Account[] }>(`${ACCOUNTS}/accounts?pageSize=20`, token, { fetcher });
  return body.accounts ?? [];
}

export async function locations(token: string, account: string, fetcher?: Fetch): Promise<Location[]> {
  if (!/^accounts\/\d+$/.test(account)) throw new GoogleError("invalid", "That is not a Business Profile account.");
  const body = await googleCall<{ locations?: Location[] }>(`${INFO}/${account}/locations?readMask=name,title,storefrontAddress&pageSize=100`, token, { fetcher });
  return body.locations ?? [];
}

/** "accounts/1/locations/2": the form the review endpoints use. */
export function reviewParent(account: string, location: string): string {
  const id = location.replace(/^.*locations\//, "");
  if (!/^accounts\/\d+$/.test(account) || !/^\d+$/.test(id)) throw new GoogleError("invalid", "That is not a Business Profile location.");
  return `${account}/locations/${id}`;
}

export async function reviews(token: string, parent: string, fetcher?: Fetch): Promise<Review[]> {
  const out: Review[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const body = await googleCall<{ reviews?: Review[]; nextPageToken?: string }>(`${REVIEWS}/${parent}/reviews?pageSize=50&orderBy=updateTime%20desc${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, token, { fetcher });
    out.push(...(body.reviews ?? []));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return out;
}

export async function getReview(token: string, reviewName: string, fetcher?: Fetch): Promise<Review | null> {
  try {
    return await googleCall<Review>(`${REVIEWS}/${reviewName}`, token, { fetcher });
  } catch (error) {
    if (error instanceof GoogleError && error.kind === "not_found") return null;
    throw error;
  }
}

/** Publishes a reply. Replacing a reply is the same call, so repeating it with the same text is harmless. */
export async function reply(token: string, reviewName: string, comment: string, fetcher?: Fetch): Promise<{ comment: string; updateTime?: string }> {
  if (!/^accounts\/\d+\/locations\/\d+\/reviews\/[\w-]+$/.test(reviewName)) throw new GoogleError("invalid", "That is not a review.");
  const body = await googleCall<{ comment?: string; updateTime?: string }>(`${REVIEWS}/${reviewName}/reply`, token, { method: "PUT", body: { comment: comment.slice(0, 4000) }, fetcher });
  return { comment: body.comment ?? comment, updateTime: body.updateTime };
}

/** Asks Google to push new and changed reviews for an account to the Pub/Sub topic. */
export async function setNotifications(token: string, account: string, topic: string, fetcher?: Fetch): Promise<void> {
  await googleCall(`${NOTIFY}/${account}/notificationSetting?updateMask=pubsubTopic,notificationTypes`, token, { method: "PATCH", body: { name: `${account}/notificationSetting`, pubsubTopic: topic, notificationTypes: ["NEW_REVIEW", "UPDATED_REVIEW"] }, fetcher });
}
