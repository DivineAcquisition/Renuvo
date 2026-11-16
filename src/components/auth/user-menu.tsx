"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { KeyIcon, SignOutIcon } from "@/components/icons";
import { AUTH } from "@/lib/auth/routes";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase() || "?";
}

/** Signing out ends the session and leaves the workspace at once: the page is replaced, not kept in history. */
export function useSignOut() {
  const { signOut } = useClerk();
  return () => signOut({ redirectUrl: `${AUTH.login}?reason=signed_out` });
}

/** Who is signed in, with the way to security settings and the way out. */
export function UserMenu() {
  const { user } = useUser();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const name = user?.fullName?.trim() || email || "Account";
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="icon-gradient flex size-9 items-center justify-center rounded-full text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <span aria-hidden>{initials(name)}</span>
        <span className="sr-only">Account menu for {name}</span>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-card p-1.5 shadow-lg">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium text-strong">{name}</p>
            {email && email !== name ? <p className="truncate text-xs text-muted-foreground">{email}</p> : null}
          </div>
          <div className="my-1 h-px bg-border" />
          <Link role="menuitem" href="/app/settings#security" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-strong hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
            <KeyIcon className="size-4 text-muted-foreground" aria-hidden />
            Security
          </Link>
          <button
            type="button"
            role="menuitem"
            disabled={leaving}
            onClick={() => {
              setLeaving(true);
              void signOut();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:text-muted-foreground"
          >
            <SignOutIcon className="size-4 text-muted-foreground" aria-hidden />
            {leaving ? "Signing out" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
