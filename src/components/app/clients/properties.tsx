"use client";

import { useCompany } from "@/components/app/company";

import { EmptyState } from "./bits";
import { PropertyCard } from "./parts";
import type { Profile } from "./profile";

export function PropertiesTab({ profile }: { profile: Profile; propertyId: string | null }) {
  const { timezone } = useCompany();
  if (!profile.properties.length) return <EmptyState title="No property yet">Add the address the client wants cleaned.</EmptyState>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {profile.properties.map((p) => (
        <PropertyCard key={p.id} property={p} customerId={profile.id} timezone={timezone} />
      ))}
    </div>
  );
}
