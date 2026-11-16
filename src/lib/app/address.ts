/**
 * Address search with Google Places (the New Places API), US addresses only (the owner's decision of
 * November 16, 2026). Every address field uses it through src/components/app/address-field.tsx.
 *
 * The browser calls Google directly with a key restricted to Selestial's own sites
 * (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY). Without the key there is no search and the fields are plain inputs.
 * A typed address is always accepted: a suggestion helps, it is never required.
 */

export type PickedAddress = {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  /** Google's id for the place, so the same place can be looked up again. */
  placeId: string;
  lat?: number;
  lng?: number;
};

export type Suggestion = { placeId: string; main: string; secondary: string };

type Component = { longText?: string; shortText?: string; types?: string[] };

const API = "https://places.googleapis.com/v1";

export function mapsKey(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || null;
}

/** Selestial's address fields from Google's address parts. Pure, so it can be tested without Google. */
export function addressFrom(components: Component[], placeId: string, location?: { latitude?: number; longitude?: number }): PickedAddress {
  const part = (type: string, form: "longText" | "shortText" = "longText") => components.find((component) => component.types?.includes(type))?.[form]?.trim() ?? "";
  const street = [part("street_number"), part("route")].filter(Boolean).join(" ");
  const unit = part("subpremise");
  const city = part("locality") || part("postal_town") || part("sublocality_level_1") || part("sublocality") || part("administrative_area_level_3");
  const zip = part("postal_code");
  const suffix = part("postal_code_suffix");
  const lat = location?.latitude;
  const lng = location?.longitude;
  return {
    line1: street || part("premise") || part("establishment"),
    ...(unit ? { line2: unit.startsWith("#") || /^(apt|unit|suite|ste)\b/i.test(unit) ? unit : `Unit ${unit}` } : {}),
    city,
    region: part("administrative_area_level_1", "shortText"),
    postalCode: zip && suffix ? `${zip}-${suffix}` : zip,
    placeId,
    ...(typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng) ? { lat, lng } : {}),
  };
}

/** A fresh token for one search: Google bills the typing and the pick together as one session. */
export function newSession(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Suggestions for what has been typed so far. US addresses only. */
export async function suggest(input: string, session: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const key = mapsKey();
  if (!key || input.trim().length < 3) return [];
  const response = await fetch(`${API}/places:autocomplete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({ input, sessionToken: session, includedRegionCodes: ["us"], includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"] }),
    signal,
  });
  if (!response.ok) throw new Error(`Address search answered ${response.status}`);
  const json = (await response.json()) as { suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[] };
  return (json.suggestions ?? []).flatMap((row) => {
    const prediction = row.placePrediction;
    if (!prediction?.placeId) return [];
    const main = prediction.structuredFormat?.mainText?.text ?? prediction.text?.text ?? "";
    return [{ placeId: prediction.placeId, main, secondary: prediction.structuredFormat?.secondaryText?.text ?? "" }];
  });
}

/** The full address of a picked suggestion. Ends the search session. */
export async function details(placeId: string, session: string): Promise<PickedAddress> {
  const key = mapsKey();
  if (!key) throw new Error("Address search is not set up");
  const response = await fetch(`${API}/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(session)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,addressComponents,location" },
  });
  if (!response.ok) throw new Error(`Address lookup answered ${response.status}`);
  const json = (await response.json()) as { id?: string; addressComponents?: Component[]; location?: { latitude?: number; longitude?: number } };
  return addressFrom(json.addressComponents ?? [], json.id ?? placeId, json.location);
}
