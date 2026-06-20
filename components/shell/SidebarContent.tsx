"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  CalendarClock,
  Wallet,
  Users,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CountUp } from "@/components/ui/count-up";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  {
    href: "/dashboard/settings/messaging",
    label: "Messaging",
    icon: MessageSquare,
  },
  {
    href: "/dashboard/settings/schedule",
    label: "Schedule",
    icon: CalendarClock,
  },
  { href: "/dashboard/settings/payments", label: "Billing", icon: Wallet },
  { href: "/dashboard/settings/team", label: "Team", icon: Users },
  { href: "/dashboard/settings/profile", label: "Settings", icon: Settings },
];

export function SidebarContent({
  orgName,
  walletBalanceCents,
  onNavigate,
}: {
  orgName: string;
  walletBalanceCents: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-2 pt-1"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#6A57FF] to-[#4F38FF] font-display text-lg font-bold text-white shadow-lg shadow-primary/30">
          R
        </span>
        <span className="font-display text-lg font-bold tracking-tight">
          Renuvo
        </span>
      </Link>

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
              onClick={onNavigate}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all hover:translate-x-0.5",
                active
                  ? "bg-gradient-to-r from-primary/12 to-transparent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-gradient-to-b from-[#6A57FF] to-[#4F38FF]" />
              )}
              <Icon
                className={cn(
                  "h-4 w-4",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              />
              {n.label}
            </Link>
          );
        })}
      </nav>

      {/* dark wallet card with radial purple glow */}
      <div className="glass-dark relative overflow-hidden rounded-2xl p-4 text-white">
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(106,87,255,0.55), transparent 70%)",
          }}
        />
        <p className="text-xs text-white/60">SMS balance</p>
        <p className="mt-1 text-2xl font-bold">
          <CountUp value={walletBalanceCents / 100} format="money" />
        </p>
        <Link
          href="/dashboard/settings/payments"
          onClick={onNavigate}
          className="mt-3 inline-block rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20"
        >
          Add funds
        </Link>
      </div>

      <p className="px-2 text-xs text-muted-foreground">{orgName}</p>
    </div>
  );
}
