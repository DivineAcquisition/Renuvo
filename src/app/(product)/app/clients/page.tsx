import type { Metadata } from "next";

import { ClientsScreen } from "@/components/app/clients/directory";

export const metadata: Metadata = { title: "Clients & Properties" };

export default function Page() {
  return <ClientsScreen />;
}
