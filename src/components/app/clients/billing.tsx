"use client";

import { EmptyState } from "./bits";
import type { Profile } from "./profile";

export function BillingTab({ profile }: { profile: Profile }) {
  return <EmptyState title="Billing">{profile.name}</EmptyState>;
}
