import type { Metadata } from "next";

import { DispatchBoardScreen } from "@/components/app/screens/dispatch/board";

export const metadata: Metadata = { title: "Dispatch Board" };

export default function Page() {
  return <DispatchBoardScreen />;
}
