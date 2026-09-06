export const HERO = {
  headline: "What are your customers really saying about you?",
  headlineAccent: "really saying",
  subhead:
    "Forward us the complaints, reviews, and texts you already get. We'll show you the patterns before they cost you customers.",
  cta: "Start seeing your patterns, free",
  secondaryCta: "See how it works",
} as const;

export const HOW_IT_WORKS = {
  eyebrow: "How it works",
  headline: "Three steps. No stack to install.",
  lead: "Forward what you already get. We do the reading.",
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
  promises: [
    { value: 0, label: "CRM connections" },
    { value: 0, label: "New habits to build" },
    { value: 1, label: "Inbox to forward to" },
  ],
} as const;

export const WHY = {
  eyebrow: "Why it works",
  headline: "The feedback is already arriving. You just can’t see it.",
  items: [
    {
      title: "No CRM connection",
      body: "Nothing to connect, map, or maintain. Renuvo never sits inside your sales stack.",
    },
    {
      title: "No new habit",
      body: "You already get the complaints. Forward them. That’s the whole workflow.",
    },
    {
      title: "No integrations",
      body: "No Zapier, no widgets, no review-site logins. Setup is an email address.",
    },
    {
      title: "Tagged automatically",
      body: "Wait time, billing, staff, product — read and labeled the moment they land.",
    },
    {
      title: "Weekly, not noisy",
      body: "A briefing that tells you what shifted — before it hardens into churn.",
    },
    {
      title: "One forwarding inbox",
      body: "Reviews, texts, voicemails, support threads. Same place. Same pattern.",
    },
  ],
} as const;

export const PATTERNS = {
  eyebrow: "Weekly, not noisy",
  headline: "See the pattern before it becomes churn.",
  body: "One forwarded inbox. Every complaint tagged. A quiet briefing that tells you what shifted this week — wait time, billing, staff, product — before it hardens into lost customers.",
} as const;

export const FAQ = {
  eyebrow: "Questions",
  headline: "Straight answers.",
  items: [
    {
      q: "Do I need to connect a CRM?",
      a: "No. No CRM connection needed. No new habit to build. Just forward what you already get.",
    },
    {
      q: "What do I actually send you?",
      a: "The complaints, reviews, and texts you already receive — Google, Yelp, SMS, voicemail transcripts, DMs, support email. Forward them to your Renuvo inbox.",
    },
    {
      q: "Is there setup or an integration?",
      a: "No. Forward feedback to your Renuvo inbox. No setup, no integrations.",
    },
    {
      q: "How often do I look at this?",
      a: "Weekly. We read, tag, and track every complaint automatically, then show you what’s trending before it becomes a pattern of lost customers.",
    },
    {
      q: "Is it free to start?",
      a: "Yes. Start seeing your patterns, free.",
    },
  ],
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
  faq: "FAQ",
  signIn: "Sign in",
  skipToContent: "Skip to content",
} as const;
