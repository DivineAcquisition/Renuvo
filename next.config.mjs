import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { instrumentationHook: true },
};

// Source-map upload only runs when SENTRY_AUTH_TOKEN is set (CI/Vercel); the
// wrapper is otherwise inert, so local/dev builds work without any Sentry env.
export default withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: "/monitoring",
  disableLogger: true,
});
