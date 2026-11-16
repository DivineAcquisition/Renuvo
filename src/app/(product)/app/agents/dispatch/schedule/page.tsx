import type { Metadata } from "next";

import { DispatchScheduleScreen } from "@/components/app/screens/dispatch/schedule";

export const metadata: Metadata = { title: "Schedule" };

export default function Page() {
  return <DispatchScheduleScreen />;
}
