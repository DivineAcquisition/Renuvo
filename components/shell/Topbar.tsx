"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, Search, X } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { SidebarContent } from "./SidebarContent";

export function Topbar({
  orgName,
  walletBalanceCents,
}: {
  orgName: string;
  walletBalanceCents: number;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const initials = orgName.slice(0, 2).toUpperCase() || "RV";

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-md">
        <button
          onClick={() => setDrawerOpen(true)}
          className="rounded-md p-2 text-muted-foreground hover:bg-secondary lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* command bar pill */}
        <button
          onClick={() => setSearchOpen(true)}
          className="group flex flex-1 items-center gap-2 rounded-full border border-border/70 bg-card px-4 py-2 text-sm text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:shadow-md hover:shadow-primary/10"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">
            Search clients, plans, messages…
          </span>
          <span className="sm:hidden">Search…</span>
          <kbd className="ml-auto hidden rounded border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
            ⌘K
          </kbd>
        </button>

        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {orgName}
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#6A57FF] to-[#4F38FF] text-xs font-bold text-white">
            {initials}
          </span>
          <form action={signOut}>
            <button className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* mobile drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              className="glass absolute left-0 top-0 h-full w-72"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "tween", duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <button
                onClick={() => setDrawerOpen(false)}
                className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
              <SidebarContent
                orgName={orgName}
                walletBalanceCents={walletBalanceCents}
                onNavigate={() => setDrawerOpen(false)}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ⌘K placeholder modal (real search wired later) */}
      <AnimatePresence>
        {searchOpen && (
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]">
            <motion.div
              className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSearchOpen(false)}
            />
            <motion.div
              className="glass relative w-full max-w-lg rounded-2xl p-4"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
            >
              <div className="flex items-center gap-2 border-b pb-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  autoFocus
                  placeholder="Search clients, plans, messages…"
                  className="w-full bg-transparent text-sm outline-none"
                />
              </div>
              <p className="px-1 pt-3 text-xs text-muted-foreground">
                Search is coming soon.
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
