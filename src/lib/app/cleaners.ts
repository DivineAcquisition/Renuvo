/** The Cleaners workspace's addresses and profile sections. Plain data, so pages and components share it. */

/** The profile sections, in order. The id is the last segment of the profile's address. */
export const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "availability", label: "Availability & Jobs" },
  { id: "onboarding", label: "Onboarding & Documents" },
  { id: "skills", label: "Skills & Equipment" },
  { id: "performance", label: "Performance & Coaching" },
  { id: "pay", label: "Pay" },
  { id: "activity", label: "Activity" },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

export function isSection(value: string | undefined | null): value is SectionId {
  return SECTIONS.some((section) => section.id === value);
}

export const CLEANERS_PATH = "/app/cleaners";
export const profilePath = (cleanerId: string, section?: SectionId) => `${CLEANERS_PATH}/${cleanerId}${section && section !== "overview" ? `/${section}` : ""}`;
