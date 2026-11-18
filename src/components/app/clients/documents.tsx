"use client";

import { EmptyState } from "./bits";
import type { Profile } from "./profile";

export function DocumentsTab({ profile }: { profile: Profile }) {
  return <EmptyState title="Documents">{profile.name}</EmptyState>;
}
