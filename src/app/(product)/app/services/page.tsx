import type { Metadata } from "next";

import { ServicesHome } from "@/components/app/services/home";

export const metadata: Metadata = { title: "Services & Pricing" };

export default function Page() {
  return <ServicesHome />;
}
