import type { Metadata } from "next";

import { DepartmentScreen } from "@/components/app/screens/department";

export const metadata: Metadata = { title: "Department" };

export default async function DepartmentPage({ params }: { params: Promise<{ department: string }> }) {
  const { department } = await params;
  return <DepartmentScreen id={department.replace(/-/g, "_")} />;
}
