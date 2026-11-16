import type { Metadata } from "next";

import { ChatBoundary } from "@/components/app/chat/boundary";
import { ChatScreen } from "@/components/app/chat/chat-screen";

export const metadata: Metadata = { title: "Chat" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ChatBoundary>
      <ChatScreen conversationId={id} />
    </ChatBoundary>
  );
}
