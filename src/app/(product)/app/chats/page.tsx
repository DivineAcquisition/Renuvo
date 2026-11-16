import type { Metadata } from "next";

import { ChatBoundary } from "@/components/app/chat/boundary";
import { ChatHistory } from "@/components/app/chat/sessions";

export const metadata: Metadata = { title: "All chats" };

export default function Page() {
  return (
    <ChatBoundary>
      <ChatHistory />
    </ChatBoundary>
  );
}
