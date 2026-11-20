"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexProviderWithAuth, useConvexAuth, useMutation, useQuery } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AgentDock } from "@/components/app/agent-dock";
import { ChatBoundary } from "@/components/app/chat/boundary";
import { ChatProvider, useChat } from "@/components/app/chat/chat-context";
import { AskButton, ChatPanel } from "@/components/app/chat/panel";
import { SidebarChatList } from "@/components/app/chat/sessions";
import { CompanyProvider, type Role, useCompany } from "@/components/app/company";
import { DetailProvider, useDetail } from "@/components/app/detail-panel";
import { useRun } from "@/components/app/form";
import { missingSetup, NotSetUp } from "@/components/app/not-set-up";
import type { TeamDepartment } from "@/components/app/overview/team-at-work";
import { NotificationBell } from "@/components/app/activation/bell";
import { AppShell } from "@/components/app/shell";
import { useRecordAuth } from "@/components/app/providers";
import { SupportBanner, type SupportSession } from "@/components/app/support/banner";
import { clearSupportSession, readSupportSession, supportClient } from "@/components/app/support/client";
import { Notice, SubmitButton, TextField } from "@/components/auth/fields";
import { AuthShell, useEvents, type TraceStep } from "@/components/auth/shell";
import { UserMenu, useSignOut } from "@/components/auth/user-menu";
import { Sidebar, SidebarStateProvider, type BusinessOption } from "@/components/app/sidebar";
import { useNow } from "@/components/app/use-now";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { convexUrl } from "@/lib/app/config";
import { LANDING_PATH, SETUP_PAGES } from "@/lib/app/navigation";
import { AUTH, withNext } from "@/lib/auth/routes";

import { api } from "../../../convex/_generated/api";
import { currentVersion } from "../../../convex/lib/trust/documents";
import type { Id } from "../../../convex/_generated/dataModel";

const STORED = "selestial.company";
const SETUP_PATH = SETUP_PAGES[0].path;

function Loading() {
  return (
    <div className="flex min-h-dvh bg-muted/50" aria-busy="true" aria-label="Loading">
      <div className="hidden w-64 shrink-0 border-r border-border bg-card p-4 lg:block">
        <Skeleton className="h-8 w-36" />
        <div className="mt-8 grid gap-2">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      </div>
      <div className="flex-1 p-6">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A signed-in person with no company yet: create one, or join one they were invited to. */
function Onboarding() {
  const invitations = useQuery(api.members.invitations, {});
  const create = useMutation(api.companies.create);
  const join = useMutation(api.members.join);
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const terms = currentVersion("terms");
  // Starts at the zone this browser reports. Nothing is assumed when it reports none.
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  const { busy, error, run } = useRun();
  // One key for this setup. If the request is sent twice (a double click, a retry after a dropped
  // connection), the record makes one company, not two.
  const [setupKey] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`));
  const { events, note } = useEvents();
  const signOut = useSignOut();
  const hasInvitations = Boolean(invitations && invitations.length > 0);
  const steps: TraceStep[] = [
    { key: "account", label: "Sign in", detail: "Your session is confirmed.", state: "done" },
    { key: "company", label: hasInvitations ? "Join a company, or name your own" : "Name your company", detail: "Whoever creates a company is its Owner. This is the only way an Owner comes to exist.", state: busy ? "active" : error ? "failed" : "needs_you" },
    { key: "standards", label: "Start on review", detail: "Your team starts on review: nothing reaches a customer or a cleaner until you approve it.", state: "todo" },
    { key: "workspace", label: "Open your workspace", detail: "You land on Home.", state: "todo" },
  ];
  return (
    <AuthShell
      eyebrow="Workspace setup"
      title="Set up your company"
      lead="You set the standards. Your team starts on review: nothing reaches a customer or a cleaner until you approve it."
      steps={steps}
      events={events}
      below={
        <button type="button" className="font-medium text-[#5126c7] underline-offset-4 hover:underline" onClick={() => void signOut()}>
          Sign out
        </button>
      }
    >
      {hasInvitations ? (
        <div className="mb-6 grid gap-2">
          <p className="text-sm font-medium text-[#211a35]">You have been invited</p>
          {invitations?.map((invitation) => (
            <div key={invitation.companyId} className="flex items-center justify-between gap-3 rounded-xl border border-[#e4e7ef] bg-[#f8f9fc] px-3.5 py-3">
              <span className="min-w-0 text-sm">
                <span className="block truncate font-medium text-[#211a35]">{invitation.companyName}</span>
                <span className="text-[#667085] capitalize">as {invitation.role}</span>
              </span>
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    note(`Joining ${invitation.companyName}`);
                    await join({ companyId: invitation.companyId as Id<"companies"> });
                  })
                }
              >
                Join
              </Button>
            </div>
          ))}
          <p className="mt-1 text-xs text-[#667085]">Or start a new company below.</p>
        </div>
      ) : null}
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          note("Creating your company");
          void run(async () => {
            await create({ name, timezone, setupKey, acceptTerms: terms.id });
            note("Company created");
          });
        }}
      >
        <TextField label="Company name" name="organization" value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} autoComplete="organization" autoFocus={!hasInvitations} />
        <TextField label="Time zone" name="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} required autoComplete="off" hint="The IANA name of your zone, such as America/Chicago. Schedules, availability and deadlines are shown on this clock." />
        <label className="flex items-start gap-2.5 text-sm text-[#3d3654]">
          <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} required className="mt-0.5 size-4 shrink-0 accent-[#6838ef]" />
          <span>
            I accept the{" "}
            <a href="/terms" target="_blank" rel="noreferrer" className="font-medium text-[#5126c7] underline underline-offset-2">
              {terms.title}
            </a>{" "}
            for this company, and have read the{" "}
            <a href="/privacy" target="_blank" rel="noreferrer" className="font-medium text-[#5126c7] underline underline-offset-2">
              Privacy notice
            </a>
            .
          </span>
        </label>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <SubmitButton busy={busy} busyLabel="Creating your company" disabled={name.trim() === "" || timezone.trim() === "" || !agreed}>
          Create company
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

/** The team console with the live record behind it. */
function Dock({ departments }: { departments?: TeamDepartment[] }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const open = useDetail();
  const activity = useQuery(api.details.activity, now ? { companyId, asOf: now, limit: 6 } : "skip");
  // The chat panel takes the same corner; one floating thing at a time.
  const { panelOpen } = useChat();
  if (!departments || panelOpen) return null;
  return <AgentDock departments={departments} activity={activity} now={now} timezone={timezone} onOpen={open} />;
}

/** The sidebar with the live record behind its badges. */
function LiveSidebar({ businesses, onSwitch, onNavigate }: { businesses: BusinessOption[]; onSwitch: (companyId: string) => void; onNavigate?: () => void }) {
  const { companyId, name, role } = useCompany();
  const now = useNow();
  const facts = useQuery(api.overview.sidebar, now ? { companyId, asOf: now } : "skip");
  return <Sidebar company={name} companyId={companyId} businesses={businesses} onSwitchBusiness={onSwitch} role={role} facts={facts} onNavigate={onNavigate} chatSessions={(close) => (
        <ChatBoundary compact>
          <SidebarChatList onNavigate={close} />
        </ChatBoundary>
      )} />;
}

function Workspace({ companyId, role, userId, businesses, onSwitch, support, children }: { companyId: Id<"companies">; role: Role; userId: string; businesses: BusinessOption[]; onSwitch: (companyId: string) => void; support?: { session: SupportSession; onExit: () => void }; children: React.ReactNode }) {
  const company = useQuery(api.companies.get, { companyId });
  const count = useQuery(api.overview.decisionCount, { companyId });
  const team = useQuery(api.overview.team, { companyId });
  const setup = useQuery(api.setup.state, { companyId });
  const router = useRouter();
  const pathname = usePathname();
  const inSetup = pathname === SETUP_PATH || pathname.startsWith(`${SETUP_PATH}/`);
  // Only an Owner who has not yet opened the workspace is taken to setup. Staff and older companies never are.
  const sendToSetup = setup?.required === true && !inSetup;
  useEffect(() => {
    if (sendToSetup) router.replace(SETUP_PATH);
  }, [sendToSetup, router]);
  if (company === undefined || setup === undefined || sendToSetup) return <Loading />;
  // Setup is its own full screen: no sidebar, dock or chat until the owner opens the workspace.
  const banner = support ? <SupportBanner session={support.session} onExit={support.onExit} /> : undefined;
  if (inSetup) {
    return (
      <CompanyProvider company={{ companyId, name: company.name, timezone: company.timezone, role }}>
        {banner ? <div className="[&>div]:top-0">{banner}</div> : null}
        {children}
      </CompanyProvider>
    );
  }
  return (
    <CompanyProvider company={{ companyId, name: company.name, timezone: company.timezone, role }}>
      <ChatProvider userId={userId} companyId={companyId}>
        <DetailProvider>
          <SidebarStateProvider userId={userId} companyId={companyId}>
            <AppShell
              company={company.name}
              decisionCount={count}
              sidebar={(close) => <LiveSidebar businesses={businesses} onSwitch={onSwitch} onNavigate={close} />}
              userSlot={<UserMenu />}
              banner={banner}
              // A support session has no chat and no notification inbox: those belong to the company's own people.
              assistant={support ? null : <AskButton />}
              notices={support ? null : <NotificationBell />}
              panel={support ? null : <ChatPanel />}
              dock={<Dock departments={team?.departments} />}
            >
              {children}
            </AppShell>
          </SidebarStateProvider>
        </DetailProvider>
      </ChatProvider>
    </CompanyProvider>
  );
}

function Companies({ userId, children }: { userId: string; children: React.ReactNode }) {
  const router = useRouter();
  const mine = useQuery(api.companies.mine, {});
  const reconnect = useMutation(api.companies.reconnect);
  // Someone with no company may have one under an earlier sign-in (the sign-in service changed). Look
  // once, before offering to create a company; a reconnected membership arrives through `mine`.
  const [looked, setLooked] = useState(false);
  const empty = mine !== undefined && mine.length === 0;
  useEffect(() => {
    if (!empty || looked) return;
    let live = true;
    reconnect({})
      .catch(() => null)
      .finally(() => {
        if (live) setLooked(true);
      });
    return () => {
      live = false;
    };
  }, [empty, looked, reconnect]);
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(STORED);
    } catch {
      return null;
    }
  });
  if (mine === undefined) return <Loading />;
  if (mine.length === 0) return looked ? <Onboarding /> : <Loading />;
  const current = mine.find((row) => row.companyId === chosen) ?? mine[0];
  // Switching company changes the whole workspace, so it lands on Home: a page for one company's
  // record means nothing in another.
  const switchTo = (companyId: string) => {
    try {
      window.localStorage.setItem(STORED, companyId);
    } catch {
      // Not remembered across visits, but the switch still happens.
    }
    setChosen(companyId);
    router.push(LANDING_PATH);
  };
  return (
    <Workspace key={current.companyId} companyId={current.companyId as Id<"companies">} role={current.role as Role} userId={userId} businesses={mine.map((row) => ({ companyId: row.companyId, name: row.name }))} onSwitch={switchTo}>
      {children}
    </Workspace>
  );
}

/**
 * No session: the workspace is taken off the screen and the person goes to sign-in, which remembers
 * this page. This covers a session that ended while the page was open, as well as a fresh visit.
 */
function ToSignIn() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    router.replace(withNext(AUTH.login, pathname));
  }, [pathname, router]);
  return <Loading />;
}

/** A support session that ended or was never this person's: nothing of the company is shown. */
function SupportEnded({ reason }: { reason: string | null }) {
  useEffect(() => clearSupportSession(), []);
  const words = reason === "expired" ? "It expired." : reason === "revoked" ? "Access was ended." : reason === "exited" ? "You exited it." : "It is not available.";
  return <NotSetUp title="This support session has ended" body={`${words} Start a new one from the staff console if you still need to help.`} action={{ label: "Back to Operations", href: "/staff/operations" }} />;
}

/**
 * A browser tab in an Admin Support Session (docs/operations/03-support-sessions.md). The company comes
 * from the session, never from the company chosen in other tabs, and every request carries the session
 * through this tab's own record client. The server checks the session on each one.
 */
function SupportWorkspace({ sessionId, userId, children }: { sessionId: Id<"supportSessions">; userId: string; children: React.ReactNode }) {
  const session = useQuery(api.support.session, { sessionId });
  const client = useMemo(() => supportClient(convexUrl()!, sessionId), [sessionId]);
  if (session === undefined) return <Loading />;
  if (session === null || !session.open) return <SupportEnded reason={session?.endReason ?? null} />;
  const onExit = () => {
    clearSupportSession();
    // A full page load on purpose: it drops this tab's support client and everything it had read.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/staff/operations");
  };
  return (
    <ConvexProviderWithAuth client={client} useAuth={useRecordAuth}>
      <Workspace key={session.companyId} companyId={session.companyId as Id<"companies">} role={session.previewRole} userId={userId} businesses={[]} onSwitch={() => undefined} support={{ session, onExit }}>
        {children}
      </Workspace>
    </ConvexProviderWithAuth>
  );
}

function SignedIn({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { isLoaded, isSignedIn, userId } = useAuth();
  // Read once per tab: a support session lives in this tab only.
  const [supportSessionId] = useState(() => (typeof window === "undefined" ? null : readSupportSession()));
  if (isLoading || !isLoaded) return <Loading />;
  if (!isSignedIn || !userId) return <ToSignIn />;
  if (!isAuthenticated) {
    // The sign-in service knows this person, but the record did not accept their session. That is a setup gap.
    return <NotSetUp title="You are signed in, but the workspace did not accept it" body="We couldn’t open your workspace just now. Nothing is wrong with your account. Please try again in a few minutes." />;
  }
  if (supportSessionId) return <SupportWorkspace sessionId={supportSessionId as Id<"supportSessions">} userId={userId}>{children}</SupportWorkspace>;
  return <Companies userId={userId}>{children}</Companies>;
}

/** Everything under /app passes through here: set up, signed in, accepted by the record, and inside a company. */
export function AppGate({ children }: { children: React.ReactNode }) {
  const missing = missingSetup();
  if (missing.length > 0) {
    return <NotSetUp title="We’ll be right back" body="Selestial isn’t available right now. Please try again in a few minutes." />;
  }
  return <SignedIn>{children}</SignedIn>;
}
