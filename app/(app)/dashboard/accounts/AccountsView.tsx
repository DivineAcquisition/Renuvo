"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { RiskBadge } from "@/components/ui/risk-badge";
import { fromCents } from "@/lib/money";
import {
  queueBulkOperation,
  getBulkOperation,
  type BulkAction,
} from "@/app/actions/bulk-accounts";
import type { AccountRow, AccountsSummary } from "@/lib/accounts/queries";

const STATUSES = ["active", "paused", "pending", "cancelled"];
const RISKS = ["high", "medium", "low"];
const SORTS: { v: string; label: string }[] = [
  { v: "value_desc", label: "Highest value" },
  { v: "next_charge_asc", label: "Next charge" },
  { v: "created_desc", label: "Newest" },
  { v: "risk_desc", label: "Riskiest" },
];

function date(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

type Filter = {
  status: string[];
  risk: string[];
  cadence: string[];
  search: string;
  sort: string;
};

export function AccountsView({
  accounts,
  summary,
  isOwner,
  filter,
}: {
  accounts: AccountRow[];
  summary: AccountsSummary;
  isOwner: boolean;
  filter: Filter;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(filter.search);
  const [modal, setModal] = useState<null | "message" | "price">(null);
  const [messageBody, setMessageBody] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [prorate, setProrate] = useState<
    "create_prorations" | "none" | "always_invoice"
  >("create_prorations");
  const [op, setOp] = useState<{
    status: string;
    total: number;
    succeeded: number;
    failed: number;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cadenceOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts)
      if (a.cadence_key) m.set(a.cadence_key, a.cadence_label ?? a.cadence_key);
    return Array.from(m.entries());
  }, [accounts]);

  function pushFilter(next: Partial<Filter>) {
    const f = { ...filter, ...next };
    const p = new URLSearchParams();
    if (f.status.length) p.set("status", f.status.join(","));
    if (f.risk.length) p.set("risk", f.risk.join(","));
    if (f.cadence.length) p.set("cadence", f.cadence.join(","));
    if (f.search) p.set("q", f.search);
    if (f.sort && f.sort !== "value_desc") p.set("sort", f.sort);
    router.push(`${pathname}?${p.toString()}`);
  }

  function toggleIn(list: string[], v: string) {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function toggleRow(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selectAll() {
    setSelected(new Set(accounts.map((a) => a.id)));
  }
  function clearSel() {
    setSelected(new Set());
  }

  const selectedRows = accounts.filter((a) => selected.has(a.id));

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function queueAndTrack(
    action: BulkAction,
    params?: Record<string, unknown>
  ) {
    const ids = Array.from(selected);
    const res = await queueBulkOperation({ action, targetIds: ids, params });
    if ("error" in res) {
      toast.error(res.error ?? "Could not queue.");
      return;
    }
    toast.success("Queued. Running in the background…");
    setOp({ status: "queued", total: ids.length, succeeded: 0, failed: 0 });
    setSelected(new Set());
    setSelectMode(false);
    const opId = res.operationId!;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const row = await getBulkOperation(opId);
      if (!row) return;
      setOp({
        status: row.status,
        total: row.total,
        succeeded: row.succeeded,
        failed: row.failed,
      });
      if (
        ["completed", "completed_with_errors", "failed"].includes(row.status)
      ) {
        if (pollRef.current) clearInterval(pollRef.current);
        toast.success(
          `Done: ${row.succeeded} succeeded, ${row.failed} failed.`
        );
        router.refresh();
      }
    }, 1500);
  }

  function skipPreview(action: BulkAction): { run: number; skip: number; reason?: string } {
    if (action === "pause") {
      const skip = selectedRows.filter((r) => r.status !== "active").length;
      return { run: selectedRows.length - skip, skip, reason: "not active" };
    }
    if (action === "resume") {
      const skip = selectedRows.filter((r) => r.status !== "paused").length;
      return { run: selectedRows.length - skip, skip, reason: "not paused" };
    }
    if (action === "cancel") {
      const skip = selectedRows.filter((r) => r.status === "cancelled").length;
      return { run: selectedRows.length - skip, skip, reason: "already cancelled" };
    }
    if (action === "message" || action === "request_payment_update") {
      const skip = selectedRows.filter((r) => !r.customer?.sms_sendable).length;
      return { run: selectedRows.length - skip, skip, reason: "not consented" };
    }
    return { run: selectedRows.length, skip: 0 };
  }

  function confirmSimple(action: BulkAction, verb: string) {
    const { run, skip, reason } = skipPreview(action);
    const msg =
      `${verb} ${run} account${run === 1 ? "" : "s"}?` +
      (skip ? ` ${skip} will be skipped (${reason}).` : "");
    if (action === "cancel") {
      if (!window.confirm(`${msg}\n\nThis cannot be undone.`)) return;
    } else if (!window.confirm(msg)) return;
    queueAndTrack(action);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          Accounts
        </h1>
        <p className="text-sm text-muted-foreground">
          Every recurring account, in one place.
        </p>
      </div>

      {/* portfolio summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard label="Active" value={String(summary.active)} />
        <SummaryCard label="Paused" value={String(summary.paused)} />
        <SummaryCard label="Past due" value={String(summary.past_due)} />
        <SummaryCard label="At risk" value={String(summary.at_risk)} />
        <SummaryCard
          label="MRR"
          value={<Money value={summary.mrr_microdollars} cents={false} />}
        />
      </div>

      {/* live op tracker */}
      {op && (
        <div className="rounded-xl border bg-card p-3 text-sm">
          Bulk action: {op.succeeded}/{op.total} done
          {op.failed > 0 && (
            <span className="text-destructive"> · {op.failed} failed</span>
          )}{" "}
          <span className="text-muted-foreground">({op.status})</span>
        </div>
      )}

      {/* toolbar */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              pushFilter({ search });
            }}
            className="flex gap-2"
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer…"
              className="h-9 w-48 rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button type="submit" variant="outline" size="sm">
              Search
            </Button>
          </form>
          <select
            value={filter.sort}
            onChange={(e) => pushFilter({ sort: e.target.value })}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {SORTS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
          {isOwner && (
            <Button
              variant={selectMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setSelectMode((v) => !v);
                clearSel();
              }}
            >
              {selectMode ? "Done selecting" : "Select"}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <Chip
              key={s}
              active={filter.status.includes(s)}
              onClick={() => pushFilter({ status: toggleIn(filter.status, s) })}
            >
              {s}
            </Chip>
          ))}
          {RISKS.map((r) => (
            <Chip
              key={r}
              active={filter.risk.includes(r)}
              onClick={() => pushFilter({ risk: toggleIn(filter.risk, r) })}
            >
              {r} risk
            </Chip>
          ))}
          {cadenceOptions.map(([key, label]) => (
            <Chip
              key={key}
              active={filter.cadence.includes(key)}
              onClick={() => pushFilter({ cadence: toggleIn(filter.cadence, key) })}
            >
              {label}
            </Chip>
          ))}
        </div>
      </div>

      {/* table */}
      <Card>
        <CardContent className="p-0">
          {accounts.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No accounts match these filters.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-card text-left text-xs uppercase text-muted-foreground">
                <tr>
                  {selectMode && (
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.size === accounts.length}
                        onChange={(e) =>
                          e.target.checked ? selectAll() : clearSel()
                        }
                      />
                    </th>
                  )}
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Cadence</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Next charge</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b last:border-0 hover:bg-secondary/40">
                    {selectMode && (
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(a.id)}
                          onChange={() => toggleRow(a.id)}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 font-medium">
                      <Link
                        href={`/dashboard/plans/${a.id}`}
                        className="hover:underline"
                      >
                        {a.customer?.full_name ?? "Customer"}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {a.cadence_label ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Money value={fromCents(a.price_cents)} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold capitalize">
                        {a.status}
                      </span>
                      {a.risk_level !== "none" && (
                        <span className="ml-1">
                          <RiskBadge level={a.risk_level} />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {date(a.next_service_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* sticky bulk bar */}
      {selectMode && selected.size > 0 && (
        <div className="sticky bottom-4 z-10 mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border bg-card p-3 shadow-lg">
          <span className="px-2 text-sm font-semibold">
            {selected.size} selected
          </span>
          <Button size="sm" variant="outline" onClick={() => confirmSimple("pause", "Pause")}>
            Pause
          </Button>
          <Button size="sm" variant="outline" onClick={() => confirmSimple("resume", "Resume")}>
            Resume
          </Button>
          <Button size="sm" variant="outline" onClick={() => setModal("price")}>
            Adjust price
          </Button>
          <Button size="sm" variant="outline" onClick={() => setModal("message")}>
            Message
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => confirmSimple("request_payment_update", "Request payment update for")}
          >
            Request payment update
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => confirmSimple("cancel", "Cancel")}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* message modal */}
      {modal === "message" && (
        <Modal onClose={() => setModal(null)} title={`Message ${selected.size} accounts`}>
          <p className="text-xs text-muted-foreground">
            {(() => {
              const { skip } = skipPreview("message");
              return skip
                ? `${skip} will be skipped (not consented to texts).`
                : "All selected customers can be texted.";
            })()}
          </p>
          <textarea
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            rows={4}
            placeholder="Write a short, friendly message…"
            className="w-full rounded-md border border-input bg-background p-3 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!messageBody.trim()}
              onClick={() => {
                setModal(null);
                queueAndTrack("message", { body: messageBody.trim() });
                setMessageBody("");
              }}
            >
              Send to {skipPreview("message").run}
            </Button>
          </div>
        </Modal>
      )}

      {/* price modal */}
      {modal === "price" && (
        <Modal onClose={() => setModal(null)} title={`Adjust price · ${selected.size} accounts`}>
          <p className="text-xs text-muted-foreground">
            Sets a new price per visit on each account&apos;s live subscription.
          </p>
          <div className="space-y-1.5">
            <label className="text-sm">New price per visit (USD)</label>
            <input
              type="number"
              min={1}
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm">Proration</label>
            <select
              value={prorate}
              onChange={(e) =>
                setProrate(e.target.value as typeof prorate)
              }
              className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="create_prorations">Prorate (credit/charge the difference)</option>
              <option value="none">No proration (new price next cycle)</option>
              <option value="always_invoice">Invoice the proration now</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!(Number(priceDollars) > 0)}
              onClick={() => {
                setModal(null);
                queueAndTrack("adjust_price", {
                  newPriceCents: Math.round(Number(priceDollars) * 100),
                  prorate,
                });
                setPriceDollars("");
              }}
            >
              Apply to {selected.size}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 font-mono text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-2xl bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
