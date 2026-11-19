/**
 * The public site's main navigation: what each menu holds, in words. Every link goes to a page or a home
 * section that exists. Home sections are written "/#id" so they work from any page; on the home page the
 * header scrolls to them and marks the one being read.
 */
import { AGENT_PAGE_IDS, AGENT_PAGES, agentPagePath } from "./agent-pages";
import { ASSESSMENT_PATH } from "./content";

export type NavIcon = "play" | "team" | "platform" | "control" | "plug" | "pricing" | "philosophy" | "security" | "messaging" | "contact";

export type NavItem = { href: string; label: string; description: string; icon?: NavIcon; agent?: (typeof AGENT_PAGE_IDS)[number]; badge?: string };

export type NavMenu = {
  id: "agents" | "product" | "company";
  label: string;
  /** Home sections that mark this menu as the one being read. */
  sections: string[];
  columns: { title?: string; items: NavItem[] }[];
  footer?: { href: string; label: string };
};

const agentItem = (id: (typeof AGENT_PAGE_IDS)[number]): NavItem => ({
  href: agentPagePath(id),
  label: AGENT_PAGES[id].name,
  description: AGENT_PAGES[id].headline,
  agent: id,
  badge: AGENT_PAGES[id].status === "live" ? undefined : "Soon",
});

export const SITE_NAV: { menus: NavMenu[]; pricing: { href: string; label: string; section: string }; signIn: { href: string; label: string }; cta: { href: string; label: string } } = {
  menus: [
    {
      id: "agents",
      label: "Agents",
      sections: ["agents", "problem"],
      columns: [
        { title: "Working today", items: AGENT_PAGE_IDS.filter((id) => AGENT_PAGES[id].status === "live").map(agentItem) },
        { title: "Coming soon, in Expand", items: AGENT_PAGE_IDS.filter((id) => AGENT_PAGES[id].status === "coming_soon").map(agentItem) },
      ],
      footer: { href: "/agents", label: "Meet the whole team" },
    },
    {
      id: "product",
      label: "Product",
      sections: ["see-it-work", "how-it-works", "platform", "control", "connections"],
      columns: [
        {
          items: [
            { href: "/#see-it-work", label: "See it work", description: "Watch a day of work move from inquiry to covered job.", icon: "play" },
            { href: "/#how-it-works", label: "How the agents coordinate", description: "One agent's finished work becomes the next one's start.", icon: "team" },
            { href: "/#platform", label: "The platform", description: "Clients, schedule, cleaners, pricing and finance in one place.", icon: "platform" },
            { href: "/#control", label: "You stay in control", description: "Set the limits; agents bring back what needs your judgment.", icon: "control" },
            { href: "/#connections", label: "Integrations", description: "Google, Stripe, texting, email and the tools you already use.", icon: "plug" },
          ],
        },
      ],
      footer: { href: ASSESSMENT_PATH, label: "Take the operations assessment" },
    },
    {
      id: "company",
      label: "Company",
      sections: ["philosophy"],
      columns: [
        {
          items: [
            { href: "/#philosophy", label: "Our philosophy", description: "Why we build an AI team, not another dashboard.", icon: "philosophy" },
            { href: "/security", label: "Security & trust", description: "How customer data is protected, and who we rely on.", icon: "security" },
            { href: "/messaging", label: "Messaging practices", description: "How texts and email are sent, and how people opt out.", icon: "messaging" },
            { href: "mailto:support@selestial.io", label: "Contact", description: "support@selestial.io", icon: "contact" },
          ],
        },
      ],
    },
  ],
  pricing: { href: "/#pricing", label: "Pricing", section: "pricing" },
  signIn: { href: "/sign-in", label: "Sign in" },
  cta: { href: ASSESSMENT_PATH, label: "Get early access" },
};
