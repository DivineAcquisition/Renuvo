"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  DollarSign,
  BarChart3,
  ShieldCheck,
  Activity,
  ArrowLeft,
  Landmark,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/tenants", label: "Tenants", icon: Building2 },
  { href: "/admin/revenue", label: "Revenue", icon: DollarSign },
  { href: "/admin/finance", label: "Book portfolio", icon: Landmark },
  { href: "/admin/benchmarks", label: "Benchmarks", icon: BarChart3 },
  { href: "/admin/a2p", label: "A2P", icon: ShieldCheck },
  { href: "/admin/system", label: "System", icon: Activity },
  { href: "/admin/email-preview", label: "Email", icon: Mail },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen bg-[hsl(250_30%_8%)] text-white">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/10 p-4 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-sm font-bold text-black">
            ◆
          </span>
          <div className="leading-tight">
            <p className="font-display text-sm font-bold">Renuvo</p>
            <p className="text-[10px] uppercase tracking-wide text-amber-400">
              Platform admin
            </p>
          </div>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map((n) => {
            const active = n.exact
              ? pathname === n.href
              : pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:bg-white/5 hover:text-white"
                )}
              >
                <Icon className="h-4 w-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/50 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to app
        </Link>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
