import type { Metadata } from "next";

import { CustomersScreen } from "@/components/app/screens/records";

export const metadata: Metadata = { title: "Customers & Properties" };

export default function Page() {
  return <CustomersScreen />;
}
