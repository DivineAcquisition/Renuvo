"use client";

import { RedirectToSignIn, useAuth, UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AgentDock } from "@/components/app/agent-dock";
import { CompanyProvider, type Role, useCompany } from "@/components/app/company";
import { DetailProvider, useDetail } from "@/components/app/detail-panel";
import { Field, FormError, TextInput, useRun } from "@/components/app/form";
import { missingSetup, NotSetUp } from "@/components/app/not-set-up";
import type { TeamDepartment } from "@/components/app/overview/team-at-work";
import { AppShell } from "@/components/app/shell";
import { Sidebar, SidebarStateProvider, type BusinessOption } from "@/components/app/sidebar";
import { useNow } from "@/components/app/use-now";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LANDING_PATH } from "@/lib/app/navigation";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const STORED = "selestial.company";

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
  // Starts at the zone this browser reports. Nothing is assumed when it reports none.
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "");
  const { busy, error, run } = useRun();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between">
          <Logo />
          <UserButton />
        </div>
        <h1 className="mt-8 font-heading text-2xl tracking-tight text-strong">Set up your company</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">You set the standards. Your team starts on review: nothing reaches a customer or a cleaner until you approve it.</p>

        {invitations && invitations.length > 0 ? (
          <div className="mt-6 grid gap-2">
            <p className="text-sm font-medium text-strong">You have been invited</p>
            {invitations.map((invitation) => (
              <div key={invitation.companyId} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <span className="text-sm">
                  <span className="font-medium text-strong">{invitation.companyName}</span> <span className="text-muted-foreground">· as {invitation.role}</span>
                </span>
                <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => join({ companyId: invitation.companyId as Id<"companies"> }))}>
                  Join
                </Button>
              </div>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">Or start a new company below.</p>
          </div>
        ) : null}

        <form
          className="mt-6 grid gap-4 rounded-2xl border border-border bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => create({ name, timezone }));
          }}
        >
          <Field label="Company name">
            <TextInput value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} autoComplete="organization" />
          </Field>
          <Field label="Time zone" hint="The IANA name of your zone. Schedules, availability and deadlines are shown on this clock.">
            <TextInput value={timezone} onChange={(event) => setTimezone(event.target.value)} required />
          </Field>
          <FormError message={error} />
          <Button type="submit" variant="primary" loading={busy}>
            Create company
          </Button>
        </form>
      </div>
    </main>
  );
}

/** The team console with the live record behind it. */
function Dock({ departments }: { departments?: TeamDepartment[] }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const open = useDetail();
  const activity = useQuery(api.details.activity, now ? { companyId, asOf: now, limit: 6 } : "skip");
  if (!departments) return null;
  return <AgentDock departments={departments} activity={activity} now={now} timezone={timezone} onOpen={open} />;
}

/** The sidebar with the live record behind its badges. */
function LiveSidebar({ businesses, onSwitch, onNavigate }: { businesses: BusinessOption[]; onSwitch: (companyId: string) => void; onNavigate?: () => void }) {
  const { companyId, name, role } = useCompany();
  const now = useNow();
  const facts = useQuery(api.overview.sidebar, now ? { companyId, asOf: now } : "skip");
  return <Sidebar company={name} companyId={companyId} businesses={businesses} onSwitchBusiness={onSwitch} role={role} facts={facts} onNavigate={onNavigate} />;
}

function Workspace({ companyId, role, userId, businesses, onSwitch, children }: { companyId: Id<"companies">; role: Role; userId: string; businesses: BusinessOption[]; onSwitch: (companyId: string) => void; children: React.ReactNode }) {
  const company = useQuery(api.companies.get, { companyId });
  const count = useQuery(api.overview.decisionCount, { companyId });
  const team = useQuery(api.overview.team, { companyId });
  if (company === undefined) return <Loading />;
  return (
    <CompanyProvider company={{ companyId, name: company.name, timezone: company.timezone, role }}>
      <DetailProvider>
        <SidebarStateProvider userId={userId} companyId={companyId}>
          <AppShell
            company={company.name}
            decisionCount={count}
            sidebar={(close) => <LiveSidebar businesses={businesses} onSwitch={onSwitch} onNavigate={close} />}
            userSlot={<UserButton />}
            dock={<Dock departments={team?.departments} />}
          >
            {children}
          </AppShell>
        </SidebarStateProvider>
      </DetailProvider>
    </CompanyProvider>
  );
}

function Companies({ userId, children }: { userId: string; children: React.ReactNode }) {
  const router = useRouter();
  const mine = useQuery(api.companies.mine, {});
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(STORED);
    } catch {
      return null;
    }
  });
  if (mine === undefined) return <Loading />;
  if (mine.length === 0) return <Onboarding />;
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

function SignedIn({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { isLoaded, isSignedIn, userId } = useAuth();
  if (isLoading || !isLoaded) return <Loading />;
  if (!isSignedIn || !userId) return <RedirectToSignIn />;
  if (!isAuthenticated) {
    // Clerk knows this person, but the record did not accept their session. That is a setup gap, and the screen says which.
    return (
      <NotSetUp
        title="You are signed in, but the record did not accept it"
        body="Clerk and Convex are not connected to each other yet. Two settings finish it:"
        items={["Clerk dashboard: turn on the Convex integration", "Convex: set CLERK_JWT_ISSUER_DOMAIN to this Clerk instance"]}
      />
    );
  }
  return <Companies userId={userId}>{children}</Companies>;
}

/** Everything under /app passes through here: set up, signed in, accepted by the record, and inside a company. */
export function AppGate({ children }: { children: React.ReactNode }) {
  const missing = missingSetup();
  if (missing.length > 0) {
    return <NotSetUp title="The app is not set up yet" body="Sign-in and the live record need these settings on this deployment before anyone can come in:" items={missing} />;
  }
  return <SignedIn>{children}</SignedIn>;
}
