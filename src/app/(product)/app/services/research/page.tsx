import type { Metadata } from "next";

import { ResearchHome } from "@/components/app/services/research";

export const metadata: Metadata = { title: "Research & Insights" };

export default function Page() {
  return <ResearchHome />;
}
