// Pure string templating for message bodies. The AI personalization layer
// (Prompt 18) wraps this — keep this module side-effect free and deterministic.

export type RenderVars = {
  first_name?: string | null;
  business_name?: string | null;
  cadence_label?: string | null;
  /** Price in cents — formatted to a currency string at render time. */
  price?: number | null;
  /** ISO 4217 code used to format `price`. Defaults to "usd". */
  currency?: string | null;
  booking_link?: string | null;
};

// The merge vars Renuvo templates support. Anything else is left untouched.
const KNOWN_VARS = [
  "first_name",
  "business_name",
  "cadence_label",
  "price",
  "booking_link",
] as const;

export function formatPrice(cents: number, currency = "usd"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    // Unknown currency code — fall back to a plain decimal with the raw code.
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/**
 * Replace `{{var}}` placeholders in `body` from `vars`.
 *  - Known vars present in `vars` are substituted (`price` is cents → currency).
 *  - Unknown placeholders, or known ones not provided, are left intact and a
 *    warning is logged. This makes a missing merge var visible rather than
 *    silently blanking the copy.
 */
export function renderTemplate(body: string, vars: RenderVars): string {
  const replacements: Partial<Record<(typeof KNOWN_VARS)[number], string>> = {};

  if (vars.first_name != null) replacements.first_name = String(vars.first_name);
  if (vars.business_name != null)
    replacements.business_name = String(vars.business_name);
  if (vars.cadence_label != null)
    replacements.cadence_label = String(vars.cadence_label);
  if (vars.booking_link != null)
    replacements.booking_link = String(vars.booking_link);
  if (vars.price != null)
    replacements.price = formatPrice(vars.price, vars.currency ?? "usd");

  return body.replace(/\{\{\s*([\w]+)\s*\}\}/g, (whole, key: string) => {
    if (key in replacements) {
      return replacements[key as (typeof KNOWN_VARS)[number]] as string;
    }
    console.warn(
      `renderTemplate: leaving unfilled merge var {{${key}}} untouched`
    );
    return whole;
  });
}
