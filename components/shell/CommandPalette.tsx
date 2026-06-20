"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Search, CornerDownLeft } from "lucide-react";

type Item = { label: string; href: string; group: string; keywords?: string };

const ITEMS: Item[] = [
  { label: "Home", href: "/dashboard", group: "Navigate" },
  { label: "Inbox", href: "/dashboard/inbox", group: "Navigate", keywords: "messages reply" },
  { label: "Accounts", href: "/dashboard/accounts", group: "Navigate", keywords: "recurring plans" },
  { label: "Capture links", href: "/dashboard/links", group: "Navigate" },
  { label: "Win-back", href: "/dashboard/winback", group: "Navigate", keywords: "churn reactivation" },
  { label: "Intelligence", href: "/dashboard/intelligence", group: "Navigate", keywords: "benchmarks" },
  { label: "Finances", href: "/dashboard/finances", group: "Navigate", keywords: "book mrr revenue" },
  { label: "Analytics", href: "/dashboard/analytics", group: "Navigate", keywords: "metrics" },
  { label: "New customer", href: "/dashboard/customers/new", group: "Actions", keywords: "add create" },
  { label: "Add funds / wallet", href: "/dashboard/settings/payments", group: "Actions", keywords: "sms balance reload card billing" },
  { label: "Services & packages", href: "/dashboard/settings/services", group: "Settings", keywords: "tiers add-ons pricing" },
  { label: "Messaging templates", href: "/dashboard/settings/messaging", group: "Settings", keywords: "sms a2p" },
  { label: "Email settings", href: "/dashboard/settings/email", group: "Settings" },
  { label: "Controls", href: "/dashboard/settings/controls", group: "Settings", keywords: "agent sequence offer notifications" },
  { label: "Schedule", href: "/dashboard/settings/schedule", group: "Settings", keywords: "quiet hours" },
  { label: "Team", href: "/dashboard/settings/team", group: "Settings", keywords: "invite members" },
  { label: "Business profile", href: "/dashboard/settings/profile", group: "Settings" },
  { label: "Data & privacy", href: "/dashboard/settings/data", group: "Settings", keywords: "export delete" },
];

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // global ⌘K / Ctrl+K toggle + Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) setQ("");
  }, [open]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return ITEMS;
    return ITEMS.filter((i) =>
      `${i.label} ${i.keywords ?? ""} ${i.group}`.toLowerCase().includes(s)
    );
  }, [q]);

  useEffect(() => setActive(0), [q, open]);

  function go(item: Item) {
    onOpenChange(false);
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = results[active];
      if (it) go(it);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[14vh]">
          <motion.div
            className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            className="glass relative w-full max-w-lg overflow-hidden rounded-2xl"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search pages and actions…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="rounded border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                ESC
              </kbd>
            </div>

            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No matches for &ldquo;{q}&rdquo;
                </p>
              ) : (
                results.map((item, i) => {
                  const showGroup =
                    i === 0 || results[i - 1].group !== item.group;
                  return (
                    <div key={item.href}>
                      {showGroup && (
                        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {item.group}
                        </p>
                      )}
                      <button
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(item)}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          i === active
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-secondary"
                        }`}
                      >
                        <span>{item.label}</span>
                        {i === active && (
                          <CornerDownLeft className="h-3.5 w-3.5 opacity-60" />
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
