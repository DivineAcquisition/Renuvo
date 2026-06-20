// Brand tokens mirrored from the app (Prompt 28B), email-safe: hex, px, web-safe
// font stacks. A brand/color change is one edit here and it propagates everywhere.
export const theme = {
  ink: "#141221",
  muted: "#6b6880",
  line: "#ECEAF6",
  surface: "#F6F6FB",
  card: "#ffffff",
  b600: "#4F38FF",
  b500: "#6A57FF",
  b400: "#9A8CFF",
  green: "#10B981",
  amber: "#F59E0B",
  red: "#E0457B",
  radius: "14px",
  fontBody:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontDisplay: "'Bricolage Grotesque', Georgia, serif",
  fontMono: "'JetBrains Mono', ui-monospace, 'SF Mono', monospace",
};

export type Brand = { name: string; logoUrl?: string; accent?: string };
