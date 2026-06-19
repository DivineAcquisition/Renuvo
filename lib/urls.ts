const CAPTURE = process.env.NEXT_PUBLIC_CAPTURE_URL ?? "http://localhost:3000";
const APP = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** The short link an SMS sends → public recurring-signup page. */
export function buildCaptureUrl(token: string): string {
  // r.renuvo.io/{token}  (kept path-short for SMS length)
  return `${CAPTURE}/${token}`;
}

/** Internal app links (dashboard deep-links, etc.). */
export function buildAppUrl(path: string): string {
  return `${APP}${path.startsWith("/") ? path : `/${path}`}`;
}
