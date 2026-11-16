import { FACTS, type DocumentText } from "./types";

export const COOKIES: DocumentText = {
  versionId: "cookies-2026-11-16",
  kind: "cookies",
  lead: `This page lists the cookies and similar tools ${FACTS.site} may use, what each is for, and how you choose. Anything optional stays off until you turn it on.`,
  sections: [
    {
      id: "what-this-covers",
      heading: "What this page covers",
      blocks: [
        {
          p: `A cookie is a small file a website stores in your browser. Some tools use similar browser storage instead. This page covers both, on ${FACTS.site} and the ${FACTS.product} service.`,
        },
        {
          p: `There are three categories. Essential cookies are always on, because sign-in and your cookie choice cannot work without them. Analytics and Advertising are optional and are off until you choose to turn them on.`,
        },
      ],
    },
    {
      id: "categories",
      heading: "Categories",
      blocks: [
        {
          table: {
            head: ["Category", "What it is for", "Until you choose"],
            rows: [
              ["Essential", `Signing in, keeping you signed in, and remembering your cookie choice.`, "On"],
              ["Analytics", "Counting visits and seeing which public pages are read.", "Off"],
              ["Advertising", `Measuring whether our ads lead people to ${FACTS.product}.`, "Off"],
            ],
          },
        },
      ],
    },
    {
      id: "cookie-list",
      heading: "The cookies and tools",
      blocks: [
        {
          table: {
            head: ["Tool", "Provider", "Category", "Cookies or storage", "Purpose"],
            rows: [
              ["Sign-in", "Clerk", "Essential", "Sign-in and session cookies, on the app pages", "Signs you in and keeps your session secure."],
              ["Cookie choice", FACTS.product, "Essential", "selestial_consent, kept for 12 months", "Remembers what you chose, so the banner does not ask again."],
              ["Vercel Web Analytics", "Vercel", "Analytics", "No cookies, according to Vercel", "Counts page views and where visitors come from."],
              ["Google Analytics 4", "Google", "Analytics", "_ga and _ga_<id>", "Measures how the public site is used."],
              ["Google Ads conversion tag", "Google", "Advertising", "_gcl_au and other Google ad-measurement cookies", "Tells us when someone who clicked our ad goes on to start the assessment."],
              ["Meta Pixel", "Meta", "Advertising", "_fbp, and _fbc after an ad click", "Measures visits that come from our ads on Facebook and Instagram."],
            ],
          },
        },
        {
          note: "Some of the optional tools may not be switched on yet. Cookie preferences shows which ones are in use right now.",
        },
      ],
    },
    {
      id: "your-choice",
      heading: "How you choose",
      blocks: [
        {
          list: [
            "Optional tools stay off until you choose. Nothing optional loads before then.",
            "Closing the banner is not a choice. Optional tools stay off and the banner asks again on your next visit.",
            "Rejecting is as easy as accepting: both are one click, side by side.",
            "You can choose Analytics and Advertising separately.",
            "Your choice lasts 12 months, or until you change it. Then we ask again.",
            "If we add tools or categories that need a new choice, we ask again.",
          ],
        },
      ],
    },
    {
      id: "changing-your-choice",
      heading: "Changing your mind",
      blocks: [
        {
          p: `Open Cookie preferences in the footer of any public page. It shows the tools in use right now and lets you turn each category on or off.`,
        },
        {
          p: "When you turn a category off, the page reloads and the optional cookies our site can remove are removed. Cookies stored by another company's website can only be removed from your browser settings.",
        },
      ],
    },
    {
      id: "global-privacy-control",
      heading: "Global Privacy Control",
      blocks: [
        {
          p: "If your browser sends a Global Privacy Control signal, we treat it as opting out. Advertising stays off whatever else you choose. Analytics stays off unless you turn it on yourself after the signal was sent.",
        },
      ],
    },
    {
      id: "where-tools-never-run",
      heading: "Where optional tools never run",
      blocks: [
        {
          p: "Optional tools run only on our public pages. Whatever you choose, they never run on:",
        },
        {
          list: [
            "the signed-in workspace;",
            "sign-in and account pages;",
            "invitation pages;",
            "the task pages cleaners and applicants open from a link;",
            "the privacy and security request forms;",
            "any address that carries a token or other secret.",
          ],
        },
        {
          p: "When an optional tool runs, it is told the path of the page only. It is never given the rest of the address, so a code or email address in a link is not passed on.",
        },
      ],
    },
    {
      id: "more-information",
      heading: "More information and contact",
      blocks: [
        {
          p: `The [Privacy Notice](/privacy) explains how we use personal information, including what these tools collect. The [Subprocessors](/security/subprocessors) page lists the providers that process data for ${FACTS.product}.`,
        },
        {
          p: `When this page changes, we publish a new version with a new date. Questions: [${FACTS.privacyEmail}](mailto:${FACTS.privacyEmail}).`,
        },
      ],
    },
  ],
};
