import type { MetadataRoute } from "next";

// The PRODUCT app and the CAPTURE pages should not be indexed.
// Marketing SEO lives on Framer (renuvo.io), managed there.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
