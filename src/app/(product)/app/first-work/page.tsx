import type { Metadata } from "next";

import { FirstWork } from "@/components/app/setup/first-work";

export const metadata: Metadata = { title: "Your first work" };

export default function Page() {
  return <FirstWork />;
}
