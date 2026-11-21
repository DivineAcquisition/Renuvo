import type { Metadata } from "next";

import { FieldsPreview } from "@/components/staff/fields-preview";

export const metadata: Metadata = { title: "Form fields" };

export default function Page() {
  return <FieldsPreview />;
}
