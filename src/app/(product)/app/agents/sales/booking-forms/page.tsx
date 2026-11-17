import type { Metadata } from "next";

import { SalesFormsScreen } from "@/components/app/screens/sales/forms";

export const metadata: Metadata = { title: "Booking Forms" };

export default function Page() {
  return <SalesFormsScreen />;
}
