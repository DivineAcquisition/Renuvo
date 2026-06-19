"use server";

import { createClient } from "@/lib/supabase/server";

export type CreateOrganizationResult =
  | { orgId: string; error: null }
  | { orgId: null; error: string };

/**
 * Turn an arbitrary org name into a URL-safe slug.
 * Lowercases, strips accents, collapses non-alphanumerics to single hyphens.
 */
function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Short, lowercase, collision-resistant suffix (e.g. "k3f9"). */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

// Postgres unique_violation — raised when the orgs.slug unique index conflicts.
const UNIQUE_VIOLATION = "23505";
const MAX_ATTEMPTS = 5;

/**
 * Onboarding bootstrap: create the caller's first organization (and their owner
 * membership) via the security-definer `create_organization` RPC.
 *
 * Pass an explicit `slug` to control it, otherwise it's derived from `name`.
 * On slug conflict we append a short random suffix and retry. No UI here — this
 * typed server action exists so later prompts (onboarding, Prompt 11) can call it.
 */
export async function createOrganization(
  name: string,
  slug?: string
): Promise<CreateOrganizationResult> {
  const trimmedName = name?.trim();
  if (!trimmedName) {
    return { orgId: null, error: "Organization name is required." };
  }

  const supabase = await createClient();
  const baseSlug = slugify(slug || trimmedName) || `org-${randomSuffix()}`;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidateSlug =
      attempt === 0 ? baseSlug : `${baseSlug}-${randomSuffix()}`;

    const { data, error } = await supabase.rpc("create_organization", {
      org_name: trimmedName,
      org_slug: candidateSlug,
    });

    if (!error) {
      return { orgId: data as string, error: null };
    }

    // Retry with a fresh suffix only on slug collisions; surface anything else.
    if (error.code !== UNIQUE_VIOLATION) {
      return { orgId: null, error: error.message };
    }
  }

  return {
    orgId: null,
    error: "Could not generate a unique slug. Please try a different name.",
  };
}
