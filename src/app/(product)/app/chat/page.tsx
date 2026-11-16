import type { Metadata } from "next";

import { ChatBoundary } from "@/components/app/chat/boundary";
import { ChatScreen } from "@/components/app/chat/chat-screen";

export const metadata: Metadata = { title: "Chat" };

export default function Page() {
  return (
    <ChatBoundary>
      <ChatScreen conversationId={null} />
    </ChatBoundary>
  );
}
