import { FACTS, type DocumentText } from "./types";

export const MESSAGING: DocumentText = {
  versionId: "messaging-2026-11-16",
  kind: "messaging",
  lead: `How text messages sent through ${FACTS.product} work: who sends them, what permission each kind needs, the checks every message passes, and how to stop them.`,
  sections: [
    {
      id: "status",
      heading: "Where texting stands",
      blocks: [
        { note: `Texting is not live yet. ${FACTS.product}'s texting provider is not connected, so no texts are sent through ${FACTS.product} today.` },
        {
          p: "This page describes how texting works in the service as it is built. If anything here changes before texting goes live, this page will change with it, under a new version and date.",
        },
      ],
    },
    {
      id: "who-sends",
      heading: "Who sends the messages",
      blocks: [
        {
          p: `The cleaning company is the sender. Each message comes from the company's own sender name and texting number, and is about the company's own work. ${FACTS.product} is the platform the company uses to send it.`,
        },
        {
          p: "If you get a text from a cleaning company and have a question about it, contact that company. Replying HELP gives you its name and contact details.",
        },
      ],
    },
    {
      id: "categories",
      heading: "Kinds of message",
      blocks: [
        {
          table: {
            head: ["Category", "What it covers", "Who gets it"],
            rows: [
              ["Operational", "Work already arranged: a job offered or assigned to a cleaner, reminders and check-ins; a customer's booked visit.", "Cleaners and customers"],
              ["Marketing", "Promotions, offers to come back, and requests for a review.", "Customers"],
              ["Recruiting", "Messages about a job application.", "Job applicants"],
            ],
          },
        },
        {
          p: "Each category needs its own permission. Permission for one does not cover another.",
        },
      ],
    },
    {
      id: "permission",
      heading: "Permission",
      blocks: [
        {
          p: "Permission is recorded for each person, for each channel and for each category. The record keeps how and when it was given, and the exact wording the person was shown.",
        },
        {
          p: "These are not permission:",
        },
        {
          list: [
            "a phone number imported from another system or a spreadsheet;",
            "a payment;",
            "a résumé or an application;",
            "a booking.",
          ],
        },
        {
          p: "The company is responsible for getting permission properly and recording it accurately, as the [Terms of Service](/terms) say.",
        },
      ],
    },
    {
      id: "checks",
      heading: "Checks before every text",
      blocks: [
        {
          p: `Every text is checked on ${FACTS.product}'s server before it is queued, and again right before it is sent. If any check fails, the text is not sent.`,
        },
        {
          list: [
            "The company's sender setup and its carrier registration status.",
            "Whether the person has opted out.",
            "Whether the person has given permission for this category of message.",
            "Quiet hours, in the company's time zone. They apply to operational messages too, unless the company chooses otherwise.",
            "Weekly frequency limits, for marketing and recruiting messages.",
            "Whether the agent sending it is paused, or the company's account is suspended.",
          ],
        },
      ],
    },
    {
      id: "stop-and-help",
      heading: "STOP, HELP and START",
      blocks: [
        {
          list: [
            "Reply STOP to stop all texts from that company to your number. STOPALL, UNSUBSCRIBE, CANCEL, END and QUIT work the same way. You get one message confirming it, and nothing more.",
            "Reply HELP to get the company's name and how to contact it.",
            "Reply START to start again. It turns back on only what STOP turned off.",
          ],
        },
        {
          p: `If you write something like "stop texting me" in your own words, it is treated as opting out, and it is flagged for a person at the company to see.`,
        },
        {
          p: "Opt-outs are kept by phone number, not by texting provider. If a company changes provider, your opt-out still holds.",
        },
      ],
    },
    {
      id: "rates-and-frequency",
      heading: "Rates and frequency",
      blocks: [
        {
          p: "Message and data rates may apply. How often you get messages varies with your work or bookings with the company. Marketing and recruiting messages are also capped each week.",
        },
      ],
    },
    {
      id: "your-number",
      heading: "Your phone number",
      blocks: [
        {
          p: `${FACTS.product} does not sell or share phone numbers or opt-in information with third parties for their marketing.`,
        },
        {
          p: "The [Privacy Notice](/privacy) explains how personal information is handled, including the records of permission and opt-outs, which are kept so that an opt-out is never forgotten.",
        },
      ],
    },
    {
      id: "contact",
      heading: "Contact",
      blocks: [
        {
          p: `For a question about a company's messages, contact that company first, or reply HELP. To report a message you think breaks these practices, write to [${FACTS.supportEmail}](mailto:${FACTS.supportEmail}). For privacy requests, use [Data requests](/privacy/requests) or [${FACTS.privacyEmail}](mailto:${FACTS.privacyEmail}).`,
        },
      ],
    },
  ],
};
