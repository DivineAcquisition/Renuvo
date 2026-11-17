/**
 * Time zones as owners know them: by the places in them, not by their identifiers. The identifier
 * (for example "America/Chicago") is what is stored; it is what the server checks and the scheduler uses.
 */

export type TimeZoneOption = { id: string; label: string; region: string; keywords: string };

/** The zones most US and Canadian cleaning companies are in, named the way people say them. */
const COMMON: readonly { id: string; label: string; also: string }[] = [
  { id: "America/New_York", label: "Eastern Time (New York, Atlanta, Miami)", also: "est edt boston philadelphia washington dc" },
  { id: "America/Chicago", label: "Central Time (Chicago, Dallas, Houston)", also: "cst cdt austin san antonio nashville minneapolis" },
  { id: "America/Denver", label: "Mountain Time (Denver, Salt Lake City)", also: "mst mdt albuquerque boise" },
  { id: "America/Phoenix", label: "Arizona (Phoenix, no daylight saving)", also: "mst tucson" },
  { id: "America/Los_Angeles", label: "Pacific Time (Los Angeles, Seattle, San Francisco)", also: "pst pdt portland las vegas san diego" },
  { id: "America/Anchorage", label: "Alaska Time (Anchorage)", also: "akst akdt" },
  { id: "Pacific/Honolulu", label: "Hawaii Time (Honolulu)", also: "hst" },
  { id: "America/Puerto_Rico", label: "Atlantic Time (Puerto Rico)", also: "ast san juan" },
  { id: "America/Toronto", label: "Eastern Time, Canada (Toronto, Ottawa, Montreal)", also: "est edt canada" },
  { id: "America/Winnipeg", label: "Central Time, Canada (Winnipeg)", also: "cst cdt canada" },
  { id: "America/Edmonton", label: "Mountain Time, Canada (Edmonton, Calgary)", also: "mst mdt canada" },
  { id: "America/Vancouver", label: "Pacific Time, Canada (Vancouver)", also: "pst pdt canada" },
  { id: "America/Halifax", label: "Atlantic Time, Canada (Halifax)", also: "ast adt canada" },
];

const REGION_WORDS: Record<string, string> = {
  America: "Americas",
  Europe: "Europe",
  Asia: "Asia",
  Africa: "Africa",
  Australia: "Australia",
  Pacific: "Pacific",
  Atlantic: "Atlantic",
  Indian: "Indian Ocean",
  Antarctica: "Antarctica",
  Arctic: "Arctic",
  Etc: "Other",
  UTC: "Other",
};

/** "America/Argentina/Buenos_Aires" → "Buenos Aires, Argentina". */
function placeOf(id: string): { label: string; region: string } {
  const parts = id.split("/");
  const region = REGION_WORDS[parts[0]] ?? "Other";
  if (parts.length === 1) return { label: id === "UTC" ? "Coordinated Universal Time (UTC)" : id.replace(/_/g, " "), region: "Other" };
  const city = parts[parts.length - 1].replace(/_/g, " ");
  const middle = parts.slice(1, -1).map((part) => part.replace(/_/g, " "));
  return { label: middle.length ? `${city}, ${middle.join(", ")}` : city, region };
}

function allIds(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (list && list.length) return list;
  } catch {
    // Older browsers: the common list below is still offered.
  }
  return COMMON.map((row) => row.id);
}

/** Every zone, the common ones first. A saved zone that is not in this browser's list is kept, so it is never lost. */
export function timeZoneOptions(saved?: string): TimeZoneOption[] {
  const common = COMMON.map((row) => ({ id: row.id, label: row.label, region: "Common in the US and Canada", keywords: `${row.label} ${row.also} ${row.id}`.toLowerCase() }));
  const seen = new Set(common.map((row) => row.id));
  const rest: TimeZoneOption[] = [];
  for (const id of allIds()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const place = placeOf(id);
    rest.push({ id, label: place.label, region: place.region, keywords: `${place.label} ${place.region} ${id}`.toLowerCase() });
  }
  if (saved && !seen.has(saved)) {
    const place = placeOf(saved);
    rest.unshift({ id: saved, label: place.label, region: place.region, keywords: `${place.label} ${saved}`.toLowerCase() });
  }
  rest.sort((a, b) => a.region.localeCompare(b.region) || a.label.localeCompare(b.label));
  return [...common, ...rest];
}

/** The friendly name of a stored zone. */
export function timeZoneLabel(id: string): string {
  return COMMON.find((row) => row.id === id)?.label ?? placeOf(id).label;
}

/** Zones whose name, places or abbreviations contain every word typed. The chosen one always stays listed. */
export function filterTimeZones(options: readonly TimeZoneOption[], query: string, keep?: string): TimeZoneOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];
  return options.filter((row) => row.id === keep || words.every((word) => row.keywords.includes(word)));
}
