"use client";

import { useState } from "react";
import Link from "next/link";
import { Money } from "@/components/ui/money";
import { fromCents } from "@/lib/money";
import type { TenantRow } from "@/lib/admin/queries";

type Filter = "all" | "suspended" | "a2p" | "past_due";

export function TenantDirectory({ tenants }: { tenants: TenantRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = tenants
    .filter((t) => t.name.toLowerCase().includes(q.toLowerCase()))
    .filter((t) => {
      if (filter === "suspended") return t.messaging_suspended;
      if (filter === "past_due") return t.subscription_status === "past_due";
      if (filter === "a2p") return t.a2p_status !== "approved";
      return true;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tenants…"
          className="h-9 flex-1 rounded-md border border-white/15 bg-white/5 px-3 text-sm text-white placeholder:text-white/40"
        />
        {(
          [
            ["all", "All"],
            ["suspended", "Suspended"],
            ["a2p", "A2P pending/failed"],
            ["past_due", "Past due"],
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              filter === k
                ? "bg-white/15 text-white"
                : "text-white/50 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-left text-xs uppercase text-white/40">
            <tr>
              <th className="p-3">Tenant</th>
              <th className="p-3">Plan</th>
              <th className="p-3">A2P</th>
              <th className="p-3 text-right">Active</th>
              <th className="p-3 text-right">MRR</th>
              <th className="p-3 text-right">Wallet</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-white/40">
                  No tenants.
                </td>
              </tr>
            )}
            {filtered.map((t) => (
              <tr
                key={t.id}
                className="border-t border-white/5 hover:bg-white/5"
              >
                <td className="p-3">
                  <Link href={`/admin/tenants/${t.id}`} className="font-medium">
                    {t.name}
                  </Link>
                  {t.messaging_suspended && (
                    <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">
                      suspended
                    </span>
                  )}
                </td>
                <td className="p-3 capitalize text-white/70">
                  {t.subscription_status}
                </td>
                <td className="p-3 capitalize text-white/70">{t.a2p_status}</td>
                <td className="p-3 text-right font-mono">{t.active_plans}</td>
                <td className="p-3 text-right">
                  <Money value={t.mrr_microdollars} cents={false} />
                </td>
                <td className="p-3 text-right">
                  <Money value={fromCents(t.wallet_balance_cents)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
