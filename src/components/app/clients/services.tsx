"use client";

import { EmptyState } from "./bits";
import type { Profile } from "./profile";

export function ServicesTab({ profile }: { profile: Profile }) {
  return <EmptyState title="Services">{profile.name}</EmptyState>;
}
