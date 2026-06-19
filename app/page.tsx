import { redirect } from "next/navigation";

// Render per request so the external redirect emits a real Location header
// (a statically-prerendered redirect to an external URL omits it).
export const dynamic = "force-dynamic";

export default function RootIndex() {
  // app.renuvo.io/ has no marketing — bounce to the Framer site.
  redirect(process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://renuvo.io");
}
