"use client";

import { EmptyState } from "./bits";
import type { Profile } from "./profile";

export function ConversationsTab({ profile }: { profile: Profile }) {
  return <EmptyState title="Conversations">{profile.name}</EmptyState>;
}
