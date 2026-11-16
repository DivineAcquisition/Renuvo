import { ChatIcon } from "@/components/icons";
import { BRAND_MARKS, type BrandSlug } from "@/lib/app/integration-brands";
import { cn } from "@/lib/utils";

type Mark =
  /** The brand's own mark, from Simple Icons. */
  | { kind: "brand"; slug: BrandSlug }
  /** A letter in the brand's colour, for a brand with no open mark. Official logo files can replace it later. */
  | { kind: "letter"; letter: string; hex: string }
  /** Selestial's own feature, with no outside brand. */
  | { kind: "glyph" };

/** Which mark each integration (by id, see src/lib/app/integrations.ts) shows. */
const MARKS: Record<string, Mark> = {
  stripe: { kind: "brand", slug: "stripe" },
  square: { kind: "brand", slug: "square" },
  "quickbooks-payments": { kind: "brand", slug: "quickbooks" },
  paypal: { kind: "brand", slug: "paypal" },
  "google-local-services-ads": { kind: "brand", slug: "google" },
  "google-ads": { kind: "brand", slug: "googleads" },
  "meta-lead-ads": { kind: "brand", slug: "meta" },
  "google-address": { kind: "brand", slug: "googlemaps" },
  "google-maps-travel": { kind: "brand", slug: "googlemaps" },
  "google-drive": { kind: "brand", slug: "googledrive" },
  "google-calendar": { kind: "brand", slug: "googlecalendar" },
  gmail: { kind: "brand", slug: "gmail" },
  "google-business-profile": { kind: "brand", slug: "google" },
  outlook: { kind: "letter", letter: "O", hex: "0078D4" },
  onedrive: { kind: "letter", letter: "OD", hex: "0364B8" },
  yelp: { kind: "brand", slug: "yelp" },
  "facebook-reviews": { kind: "brand", slug: "facebook" },
  "texting-number": { kind: "glyph" },
  "quickbooks-online": { kind: "brand", slug: "quickbooks" },
  xero: { kind: "brand", slug: "xero" },
  indeed: { kind: "brand", slug: "indeed" },
  checkr: { kind: "letter", letter: "C", hex: "475467" },
  jobber: { kind: "letter", letter: "J", hex: "475467" },
  "housecall-pro": { kind: "letter", letter: "H", hex: "475467" },
  zenmaid: { kind: "letter", letter: "Z", hex: "475467" },
  launch27: { kind: "letter", letter: "L", hex: "475467" },
};

const BOX = { sm: "size-6 rounded-md", md: "size-9 rounded-lg", lg: "size-11 rounded-xl" } as const;
const GLYPH = { sm: "size-3.5", md: "size-5", lg: "size-6" } as const;
const LETTER = { sm: "text-[9px]", md: "text-sm", lg: "text-base" } as const;

/**
 * An integration's logo on a white tile, so a brand's colours read the same in light and dark. Decorative:
 * the integration's name is always written beside it.
 */
export function IntegrationMark({ id, size = "md", className }: { id: string; size?: keyof typeof BOX; className?: string }) {
  const mark = MARKS[id];
  return (
    <span className={cn("flex shrink-0 items-center justify-center border border-black/10 bg-white shadow-sm", BOX[size], className)} aria-hidden data-integration-mark={id}>
      {mark?.kind === "brand" ? (
        <svg viewBox="0 0 24 24" className="size-[58%]" fill={`#${BRAND_MARKS[mark.slug].hex}`} focusable="false">
          <path d={BRAND_MARKS[mark.slug].path} />
        </svg>
      ) : mark?.kind === "letter" ? (
        <span className={cn("font-heading font-bold tracking-tight", LETTER[size])} style={{ color: `#${mark.hex}` }}>
          {mark.letter}
        </span>
      ) : (
        <ChatIcon className={cn("text-brand-500", GLYPH[size])} />
      )}
    </span>
  );
}
