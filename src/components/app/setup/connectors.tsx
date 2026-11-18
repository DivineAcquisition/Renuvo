"use client";

/**
 * Jobber and Housecall Pro during setup: connect, read clients, then check and import them through the same
 * review as a spreadsheet (ReviewImport). Each system says plainly when it isn't available, and the
 * spreadsheet path stays beside it either way.
 */
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, messageOf, TextInput } from "@/components/app/form";
import {
  Check,
  ExternalLink,
  Loader2,
  Plug,
  RefreshCw,
  Unplug,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ReviewImport } from "./import";

type Status = NonNullable<
  ReturnType<typeof useQuery<typeof api.connectors.status>>
>;
type Connection = Status["jobber"]["connection"];

const RETURN_WORDS: Record<string, string> = {
  connected: "Jobber is connected.",
  declined: "Jobber wasn't connected: access was declined in Jobber.",
  expired: "That Jobber sign-in took too long or was already used. Try again.",
  failed: "Jobber couldn't be connected. Try again, or use a Jobber export.",
};

export function ConnectedImport() {
  const { companyId } = useCompany();
  const status = useQuery(api.connectors.status, { companyId });
  // Coming back from Jobber's sign-in: say how it went once, then tidy the address.
  const [returned] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("connector") !== "jobber") return null;
    return RETURN_WORDS[params.get("result") ?? ""] ?? RETURN_WORDS.failed;
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connector") !== "jobber") return;
    params.delete("connector");
    params.delete("result");
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${params.size ? `?${params}` : ""}`,
    );
  }, []);

  if (!status) return null;
  return (
    <div className="grid gap-3">
      {returned ? (
        <p
          className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm text-strong"
          role="status"
        >
          {returned}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <JobberCard status={status} />
        <HousecallCard status={status} />
      </div>
      {status.read ? <ReadPanel read={status.read} /> : null}
    </div>
  );
}

function Card({
  name,
  connection,
  available,
  canManage,
  children,
}: {
  name: string;
  connection: Connection;
  available: boolean;
  canManage: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-border px-3.5 py-3 text-sm"
      aria-label={name}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Plug className="size-4 text-muted-foreground" aria-hidden />
        <span className="font-medium text-strong">{name}</span>
        {connection?.status === "connected" ? (
          <Badge variant="success">Connected</Badge>
        ) : connection?.status === "checking" ? (
          <Badge variant="info">Checking</Badge>
        ) : connection?.status === "expired" ? (
          <Badge variant="warning">Connect again</Badge>
        ) : !available ? (
          <Badge variant="outline">Not available yet</Badge>
        ) : null}
      </div>
      {connection?.status === "connected" ? (
        <p className="text-muted-foreground">
          {connection.account ? `Reading from ${connection.account}. ` : ""}
          Selestial only reads; nothing is changed in {name}.
        </p>
      ) : null}
      {connection?.problem && connection.status !== "connected" ? (
        <p className="text-strong">{connection.problem}</p>
      ) : null}
      {!available && !connection ? (
        <p className="text-muted-foreground">
          A direct connection isn&apos;t switched on for your workspace yet. Export
          your client list from {name} and choose the file below instead.
        </p>
      ) : null}
      {!canManage && available && !connection ? (
        <p className="text-muted-foreground">
          Only the Owner can connect {name}.
        </p>
      ) : null}
      {children}
    </section>
  );
}

function JobberCard({ status }: { status: Status }) {
  const { companyId } = useCompany();
  const start = useMutation(api.connectors.startJobber);
  const read = useMutation(api.connectors.read);
  const disconnect = useMutation(api.connectors.disconnect);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { connection, available } = status.jobber;

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      name="Jobber"
      connection={connection}
      available={available}
      canManage={status.canManage}
    >
      {status.canManage && available && connection?.status !== "connected" ? (
        <>
          <p className="text-muted-foreground">
            Sign in to Jobber and allow Selestial to read your clients,
            properties and upcoming visits.
          </p>
          <Button
            variant="primary"
            size="sm"
            className="self-start"
            loading={busy}
            onClick={() =>
              void act(async () => {
                const { url } = await start({
                  companyId,
                  returnTo: window.location.origin,
                });
                window.location.assign(url);
              })
            }
          >
            <ExternalLink className="size-3.5" aria-hidden />
            Connect Jobber
          </Button>
        </>
      ) : null}
      {status.canManage && connection?.status === "connected" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={busy}
            onClick={() =>
              void act(() => read({ companyId, system: "jobber" }))
            }
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Read clients again
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(() => disconnect({ companyId, system: "jobber" }))
            }
          >
            <Unplug className="size-3.5" aria-hidden />
            Disconnect
          </Button>
        </div>
      ) : null}
      {connection?.status === "connected" ? (
        <p className="text-xs text-muted-foreground">
          Disconnecting stops Selestial at once. To remove the app from Jobber
          too, do it in Jobber under Settings › Apps.
        </p>
      ) : null}
      {error ? (
        <p className="text-strong" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

function HousecallCard({ status }: { status: Status }) {
  const { companyId } = useCompany();
  const connect = useMutation(api.connectors.connectHousecall);
  const read = useMutation(api.connectors.read);
  const disconnect = useMutation(api.connectors.disconnect);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { connection, available } = status.housecall;

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      name="Housecall Pro"
      connection={connection}
      available={available}
      canManage={status.canManage}
    >
      {status.canManage &&
      available &&
      (!connection || connection.status === "expired") ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await connect({ companyId, apiKey: key });
              setKey("");
            });
          }}
        >
          <Field
            label="API key"
            hint="In Housecall Pro, an Admin creates one under App Store › API. The API comes with the MAX plan. Selestial stores it sealed and only reads with it."
          >
            <TextInput
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              maxLength={200}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="self-start"
            loading={busy}
            disabled={key.trim().length < 16}
          >
            Connect Housecall Pro
          </Button>
        </form>
      ) : null}
      {connection?.status === "checking" ? (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Checking the key with Housecall Pro…
        </p>
      ) : null}
      {status.canManage && connection?.status === "connected" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            loading={busy}
            onClick={() =>
              void act(() => read({ companyId, system: "housecall_pro" }))
            }
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Read clients again
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              void act(() => disconnect({ companyId, system: "housecall_pro" }))
            }
          >
            <Unplug className="size-3.5" aria-hidden />
            Disconnect
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="text-strong" role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  );
}

const NAMES = { jobber: "Jobber", housecall_pro: "Housecall Pro" } as const;

function ReadPanel({ read }: { read: NonNullable<Status["read"]> }) {
  const name = NAMES[read.system];
  if (read.status === "reading")
    return (
      <p
        className="flex items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm text-strong"
        role="status"
      >
        <Loader2
          className="size-4 animate-spin text-muted-foreground"
          aria-hidden
        />
        Reading your clients from {name}…
      </p>
    );
  if (read.status === "failed")
    return (
      <p
        className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-strong"
        role="alert"
      >
        {read.problem ?? `${name} couldn't be read.`}
      </p>
    );
  return <ReadyRead read={read} name={name} />;
}

function ReadyRead({
  read,
  name,
}: {
  read: NonNullable<Status["read"]>;
  name: string;
}) {
  const { companyId } = useCompany();
  const rows = useQuery(api.connectors.readRows, {
    companyId,
    readId: read.id as Id<"connectorReads">,
  });
  const discard = useMutation(api.connectors.discard);
  return (
    <section
      className="grid gap-3 rounded-xl border border-border p-3"
      aria-label={`Clients read from ${name}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Check className="size-4 text-success" aria-hidden />
        <span className="font-medium text-strong">
          {read.clients} {read.clients === 1 ? "client" : "clients"} read from{" "}
          {name}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          onClick={() =>
            void discard({ companyId, readId: read.id as Id<"connectorReads"> })
          }
        >
          Clear this read
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {read.visits
          ? `${read.visits} upcoming ${read.visits === 1 ? "visit was" : "visits were"} found and kept as a note on each client. None is booked in Selestial and no cleaner is offered work from them. `
          : ""}
        {read.truncated
          ? "You have more clients than one import takes: these are the first 1,000. Import them, then read again for the rest. "
          : ""}
        This copy is deleted after a day.
      </p>
      {rows ? (
        <ReviewImport
          rows={rows.rows}
          source={rows.system}
          label={rows.label}
          keyBase={`read:${read.id}`}
        />
      ) : null}
    </section>
  );
}
