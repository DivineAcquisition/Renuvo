import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // No page may be shown inside another site's frame, except a company's own public booking form,
      // which a company embeds on its website on purpose (the form's embed code).
      { source: "/:path((?!c/form/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
      // A link is a credential: its address is never sent on to another site. The cleaner pages may ask for
      // the phone's position, for check-in. It is allowed on all of them because the offer page leads to the
      // job page without a fresh page load, and a page keeps the policy it was loaded with.
      {
        source: "/c/:path*",
        headers: [
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      // The pay page runs Stripe's payment form, which may offer Apple Pay or Google Pay from Stripe's frame.
      // Listed after the rule above so its Permissions-Policy is the one that applies there.
      {
        source: "/c/pay/:path*",
        headers: [{ key: "Permissions-Policy", value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")' }],
      },
    ];
  },
};

export default nextConfig;
