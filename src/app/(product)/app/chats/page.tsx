import type { Metadata } from "next";

import { ChatHistory } from "@/components/app/chat/sessions";

export const metadata: Metadata = { title: "All chats" };

export default function Page() {
  return <ChatHistory />;
}
