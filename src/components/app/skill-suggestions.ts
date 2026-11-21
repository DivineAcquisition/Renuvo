"use client";

import { useQuery } from "convex/react";

import { useCompany } from "@/components/app/company";
import type { ListSuggestion } from "@/components/ui/fields";

import { api } from "../../../convex/_generated/api";

/**
 * Skills to offer while typing, from the company's own service catalog (active and draft services).
 * They are suggestions: choosing one records what the owner confirmed, it is not a check of training.
 */
export function useSkillSuggestions(extra: readonly string[] = []): ListSuggestion[] {
  const { companyId } = useCompany();
  const catalog = useQuery(api.services.catalog, { companyId });
  const out = new Map<string, ListSuggestion>();
  for (const service of catalog?.services ?? []) {
    if (service.status === "archived") continue;
    const value = service.name.trim();
    if (value && !out.has(value.toLowerCase())) out.set(value.toLowerCase(), { value, detail: "From your services" });
  }
  for (const value of extra) if (value.trim() && !out.has(value.trim().toLowerCase())) out.set(value.trim().toLowerCase(), { value: value.trim(), detail: "Already used here" });
  return [...out.values()];
}
