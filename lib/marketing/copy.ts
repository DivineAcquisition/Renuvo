export const HERO = {
  headline: "What are your customers really saying about you?",
  headlineAccent: "really saying",
  subhead:
    "Forward us the complaints, reviews, and texts you already get. We'll show you the patterns before they cost you customers.",
  cta: "Start seeing your patterns, free",
} as const;

export const HOW_IT_WORKS = {
  eyebrow: "How it works",
  headline: "Three steps. No stack to install.",
  steps: [
    {
      title: "Forward feedback to your Renuvo inbox",
      body: "No setup, no integrations. The reviews, complaints, and texts you already get — just send them on.",
    },
    {
      title: "We read, tag, and track every complaint",
      body: "Automatically. Wait time, billing, staff, product — tagged the moment it lands, without a new workflow.",
    },
    {
      title: "See what's trending, weekly",
      body: "Before it becomes a pattern of lost customers. One quiet briefing, not another dashboard to live in.",
    },
  ],
} as const;

export const TRUST = {
  line: "No CRM connection needed. No new habit to build. Just forward what you already get.",
} as const;

export const SOURCES = [
  "Google reviews",
  "Yelp",
  "SMS",
  "Voicemail transcripts",
  "Instagram DMs",
  "Facebook comments",
  "Support email",
  "NPS replies",
] as const;

export const NAV = {
  how: "How it works",
  patterns: "Patterns",
  signIn: "Sign in",
  skipToContent: "Skip to content",
} as const;
