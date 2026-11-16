import { loadPublicTrust } from "@/lib/trust/public";

/**
 * security.txt (RFC 9116). Published only when a security contact is verified in the trust records;
 * otherwise this address answers "not found" rather than pointing researchers at an unread inbox.
 */
export const revalidate = 300;

export async function GET() {
  const trust = await loadPublicTrust();
  const contact = trust.settings.contacts.security;
  const expires = trust.settings.securityTxtExpiresOn;
  const site = process.env.NEXT_PUBLIC_SITE_ORIGIN?.trim().replace(/\/$/, "") || "https://www.selestial.io";
  if (!contact || !expires || new Date(`${expires}T00:00:00Z`).getTime() <= Date.now()) {
    return new Response("Not found.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const body = [`Contact: mailto:${contact}`, `Contact: ${site}/security/report`, `Expires: ${new Date(`${expires}T00:00:00Z`).toISOString()}`, "Preferred-Languages: en", `Canonical: ${site}/.well-known/security.txt`, `Policy: ${site}/security/report`, ""].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
