import * as Sentry from "@sentry/nextjs";
import { scrub } from "@/lib/observability/scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: (event) => scrub(event),
  beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
});
