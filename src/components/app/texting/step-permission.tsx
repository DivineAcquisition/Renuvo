"use client";

/**
 * Step 3: how people agree to the company's texts. Where permission is asked, the exact words they see,
 * the company's own privacy policy and texting terms, and its sign-up page. Selestial drafts every text
 * from the company's details; the owner edits any of it. Published pages belong to the company and are
 * checked to open. A place is only described as recording consent when Selestial actually records it there.
 */
import { useMutation } from "convex/react";
import { useState } from "react";

import { Field, TextArea, TextInput } from "@/components/app/form";
import { CheckCircle2, CircleDashed, Copy, ExternalLink, RefreshCw, TriangleAlert } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";
import { PERMISSION_PLACES, type DraftKey } from "../../../../convex/lib/texting/schema";
import { useSetup } from "./context";
import { ChoiceCard, Disclosure, Note, PageState, Section, StepHeading } from "./parts";

const PLACE_WORDS: Record<(typeof PERMISSION_PLACES)[number], { label: string; hint: string }> = {
  booking_form: { label: "Booking form", hint: "Your Selestial booking page" },
  quote_form: { label: "Quote or inquiry form", hint: "People asking for an estimate" },
  cleaner_application: { label: "Cleaner job application", hint: "People applying to work with you" },
  team_onboarding: { label: "Team onboarding", hint: "Cleaners setting up their team portal" },
  website: { label: "Your website", hint: "A sign-up form people can open from your site" },
  other: { label: "Somewhere else", hint: "Describe it below" },
};

const DRAFT_WORDS: Record<DraftKey, { label: string; hint: string; rows: number }> = {
  sms_consent: { label: "Text permission wording", hint: "Shown beside the optional, unchecked text box on every form.", rows: 4 },
  marketing_consent: { label: "Marketing permission wording", hint: "A separate, optional box just for promotions.", rows: 3 },
  help_reply: { label: "Reply to HELP", hint: "Sent when someone texts HELP.", rows: 2 },
  stop_reply: { label: "Reply to STOP", hint: "Sent once when someone opts out.", rows: 2 },
  start_reply: { label: "Reply to START", hint: "Sent when someone opts back in.", rows: 2 },
  opt_in_flow: { label: "How people agree (for the carriers)", hint: "Carriers read this to understand your sign-up. Selestial keeps it in step with your choices above.", rows: 6 },
  privacy: { label: "Privacy policy", hint: "Your business's own policy. Carriers require it to be yours, not Selestial's.", rows: 14 },
  terms: { label: "Texting terms", hint: "What people can expect from your texts.", rows: 12 },
};

const PLACE_STATE: Record<"records" | "not_yet" | "described", { label: string; variant: "success" | "warning" | "outline" }> = {
  records: { label: "Records consent", variant: "success" },
  not_yet: { label: "Not yet", variant: "warning" },
  described: { label: "Described by you", variant: "outline" },
};

export function PermissionStep() {
  const { view, commit, locked } = useSetup();
  const places = view.setup.places;
  const [other, setOther] = useState(view.setup.otherPlace ?? "");
  const marketing = view.setup.activities.includes("promotions");
  const togglePlace = (place: string) => void commit({ places: places.includes(place) ? places.filter((row) => row !== place) : [...places, place] });

  return (
    <>
      <StepHeading eyebrow="Step 3 of 6" title="Permission to text" lead="People must agree before your business texts them. Here's where they agree, the words they see, and the pages carriers check. Selestial has drafted everything from your details; change anything you like." />

      <Section title="Where do people agree to your texts?" lead="Choose every place. Selestial records each person's answer with the exact wording they saw.">
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Where permission is asked">
          {PERMISSION_PLACES.map((place) => (
            <ChoiceCard key={place} multi selected={places.includes(place)} onPress={() => togglePlace(place)} title={PLACE_WORDS[place].label} hint={PLACE_WORDS[place].hint} disabled={locked} />
          ))}
        </div>
        {places.includes("other") ? (
          <Field label="Where else?" hint="For example: a paper form at the office. Keep a record of each person's agreement there.">
            <TextInput value={other} onChange={(event) => setOther(event.target.value)} onBlur={() => other !== (view.setup.otherPlace ?? "") && void commit({ otherPlace: other })} maxLength={300} />
          </Field>
        ) : null}
        {view.places.length ? (
          <ul className="grid gap-1.5" aria-label="What each place does today">
            {view.places.map((row) => (
              <li key={row.place} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-strong">{PLACE_WORDS[row.place as keyof typeof PLACE_WORDS]?.label ?? row.place}</span>
                  <span className="text-muted-foreground">{row.words}</span>
                </span>
                <Badge variant={PLACE_STATE[row.state].variant}>{PLACE_STATE[row.state].label}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="The words people see">
        <Draft k="sms_consent" />
        {marketing ? <Draft k="marketing_consent" /> : null}
        <Note>The text box is always optional and starts unchecked. It&apos;s labelled for texts only and is separate from any other terms you ask people to accept.</Note>
      </Section>

      <Section title="Automatic replies">
        <div className="grid gap-3">
          <Draft k="help_reply" />
          <Draft k="stop_reply" />
          <Draft k="start_reply" />
        </div>
      </Section>

      <Section title="Your privacy policy and texting terms" lead="Carriers require the privacy policy of the business that's registering. Selestial's own policy can't be used for your business.">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Where your pages live">
          <ChoiceCard selected={view.setup.hosting !== "own_site"} onPress={() => void commit({ hosting: "selestial" })} title="Publish them for me" hint="Selestial publishes your pages under your company's name. Recommended." disabled={locked} />
          <ChoiceCard selected={view.setup.hosting === "own_site"} onPress={() => void commit({ hosting: "own_site" })} title="They're on my website" hint="Use your own privacy policy and texting terms pages." disabled={locked} />
        </div>
        {view.setup.hosting === "own_site" ? <OwnSite /> : (
          <div className="grid gap-3">
            <Draft k="privacy" />
            <Draft k="terms" />
          </div>
        )}
        <Note>These drafts are a starting point written from your details, not legal advice. Your business is responsible for its policies; have them reviewed if you&apos;re unsure.</Note>
      </Section>

      <Section title="Your pages" lead="Publish to make them public. Each link is opened to check it works, and the carriers will open them too.">
        <Pages />
      </Section>

      <Disclosure summary={<span>How people agree, as the carriers read it</span>}>
        <Draft k="opt_in_flow" />
      </Disclosure>
    </>
  );
}

function Draft({ k }: { k: DraftKey }) {
  const { view, commit, locked } = useSetup();
  const saved = view.setup.drafts[k];
  const [text, setText] = useState(saved?.text ?? "");
  const [lastSaved, setLastSaved] = useState(saved?.text ?? "");
  // Selestial rewrites an unedited draft when the details it's written from change: show the new words.
  if (saved && !saved.edited && saved.text !== lastSaved && text === lastSaved) {
    setText(saved.text);
    setLastSaved(saved.text);
  }
  const gaps = view.drafts.find((row) => row.key === k)?.gaps ?? [];
  const words = DRAFT_WORDS[k];
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-strong" id={`draft-${k}`}>
          {words.label}
        </span>
        {gaps.length ? <Badge variant="warning">Needs attention</Badge> : saved?.edited ? <Badge variant="outline">Your words</Badge> : <Badge variant="outline">Selestial&apos;s draft</Badge>}
        {saved?.edited && !locked ? (
          <button
            type="button"
            className="ml-auto text-xs font-medium text-brand-300 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"
            onClick={() => {
              setLastSaved("");
              void commit({ drafts: { [k]: "" } });
            }}
          >
            Use Selestial&apos;s draft
          </button>
        ) : null}
      </div>
      <TextArea
        aria-labelledby={`draft-${k}`}
        rows={words.rows}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text.trim() !== (saved?.text ?? "").trim()) {
            setLastSaved(text);
            void commit({ drafts: { [k]: text } });
          }
        }}
        className={k === "privacy" || k === "terms" ? "font-mono text-xs leading-5" : undefined}
      />
      <p className="text-xs text-muted-foreground">{words.hint}</p>
      {gaps.length ? (
        <ul className="grid gap-1 text-xs text-warning-foreground">
          {gaps.map((gap) => (
            <li key={gap} className="flex gap-1.5">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
              Needs to {gap}.
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function OwnSite() {
  const { view, commit } = useSetup();
  const [privacy, setPrivacy] = useState(view.setup.ownSite?.privacyUrl ?? "");
  const [terms, setTerms] = useState(view.setup.ownSite?.termsUrl ?? "");
  const save = () => {
    if (privacy !== (view.setup.ownSite?.privacyUrl ?? "") || terms !== (view.setup.ownSite?.termsUrl ?? "")) void commit({ ownSite: { privacyUrl: privacy, termsUrl: terms } });
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Privacy policy address" hint="It must name your business and say mobile numbers aren't shared for marketing.">
        <TextInput value={privacy} onChange={(event) => setPrivacy(event.target.value)} onBlur={save} type="url" inputMode="url" placeholder="https://" />
      </Field>
      <Field label="Texting terms address">
        <TextInput value={terms} onChange={(event) => setTerms(event.target.value)} onBlur={save} type="url" inputMode="url" placeholder="https://" />
      </Field>
    </div>
  );
}

function Pages() {
  const { view, run, companyId, locked } = useSetup();
  const publish = useMutation(api.textingSetup.publish);
  const checkNow = useMutation(api.textingSetup.checkNow);
  const [copied, setCopied] = useState<string | null>(null);
  const signup = view.pages.find((row) => row.kind === "signup");
  const outdated = view.pages.some((row) => row.version !== null && !row.current);
  const none = view.pages.every((row) => row.state === "drafted");

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="grid gap-3">
      <ul className="grid gap-2">
        {view.pages.map((row) => (
          <li key={row.kind} className="grid gap-1 rounded-xl border border-border px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-strong">{row.kind === "signup" ? "Sign-up page" : row.kind === "terms" ? "Texting terms" : "Privacy policy"}</span>
              <PageState state={row.state} />
              {row.own ? <Badge variant="outline">Your website</Badge> : row.version ? <span className="text-xs text-muted-foreground">Version {row.version}</span> : null}
            </div>
            {row.url && (row.own || row.version) ? (
              <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs break-all text-brand-300 underline-offset-2 hover:underline">
                {row.url}
                <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
            ) : null}
            {row.check ? (
              <p className={`flex items-center gap-1.5 text-xs ${row.check.ok ? "text-success-foreground" : "text-warning-foreground"}`}>
                {row.check.ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <TriangleAlert className="size-3.5" aria-hidden />}
                {row.check.ok ? "Opens correctly" : row.check.problem}
              </p>
            ) : row.version || row.own ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CircleDashed className="size-3.5" aria-hidden />
                Not checked yet
              </p>
            ) : null}
            {!row.current ? <p className="text-xs text-warning-foreground">You&apos;ve changed the words since publishing. Publish again to update the page.</p> : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void run((revision) => publish({ companyId, revision }))} disabled={locked}>
          {none ? "Publish my pages" : outdated ? "Publish my changes" : "Publish again"}
        </Button>
        <Button variant="outline" onClick={() => void run(async () => void (await checkNow({ companyId })))} disabled={none}>
          <RefreshCw aria-hidden />
          Check the links again
        </Button>
      </div>
      {signup?.url && signup.version ? (
        <Disclosure summary={<span>Add the sign-up form to your own website</span>}>
          <div className="grid gap-3 text-xs">
            <p className="text-muted-foreground">Link to it, or embed it. Either way, every yes is recorded with the exact wording shown.</p>
            <Snippet label="Link" text={signup.url} copied={copied === "link"} onCopy={() => void copy("link", signup.url!)} />
            <Snippet label="Embed" text={`<iframe src="${signup.url}?embed=1" title="Texts" style="width:100%;max-width:520px;height:460px;border:0"></iframe>`} copied={copied === "embed"} onCopy={() => void copy("embed", `<iframe src="${signup.url}?embed=1" title="Texts" style="width:100%;max-width:520px;height:460px;border:0"></iframe>`)} />
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}

function Snippet({ label, text, copied, onCopy }: { label: string; text: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="grid gap-1">
      <span className="font-medium text-strong">{label}</span>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 rounded-lg bg-muted px-2.5 py-2 font-mono text-[11px] break-all text-strong">{text}</code>
        <Button variant="outline" size="sm" onClick={onCopy} aria-label={`Copy ${label.toLowerCase()}`}>
          <Copy aria-hidden />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
