"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { clerkPublishableKey, convexUrl } from "@/lib/app/config";
import { AUTH } from "@/lib/auth/routes";

const clients = new Map<string, ConvexReactClient>();

function clientFor(url: string) {
  const existing = clients.get(url);
  if (existing) return existing;
  const client = new ConvexReactClient(url);
  clients.set(url, client);
  return client;
}

/** The name of the token the record accepts. It is a template on the sign-in service (docs/foundation/03-authentication.md). */
const RECORD_TOKEN = "convex";

/**
 * How the live record learns who is signed in. It always asks the sign-in service for the full
 * "convex" token, which carries the person's email and whether it is confirmed. The service's plain
 * session token can also be accepted by the record, but it has no email in it, and invitations and
 * company setup depend on a confirmed email. So the plain token is never used.
 */
export function useRecordAuth() {
  const { isLoaded, isSignedIn, getToken, sessionId } = useAuth();
  // The service hands back a new function on every render. Keeping the newest one in a ref lets the
  // record's connection stay the same connection instead of signing in again each time.
  const latest = useRef(getToken);
  useEffect(() => {
    latest.current = getToken;
  }, [getToken]);
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        return await latest.current({ template: RECORD_TOKEN, skipCache: forceRefreshToken });
      } catch {
        return null;
      }
    },
    // A new session is a new identity: the record must ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );
  return useMemo(() => ({ isLoading: !isLoaded, isAuthenticated: isSignedIn ?? false, fetchAccessToken }), [isLoaded, isSignedIn, fetchAccessToken]);
}

/**
 * Sign-in and the live record, for the product only. The public page loads neither. The sign-in service
 * is used headlessly: every screen a person sees is Selestial's own (src/components/auth).
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const key = clerkPublishableKey();
  const url = convexUrl();
  if (!key || !url) return children;
  return (
    <ClerkProvider
      publishableKey={key}
      signInUrl={AUTH.login}
      signUpUrl={AUTH.signup}
      signInFallbackRedirectUrl={AUTH.callback}
      signUpFallbackRedirectUrl={AUTH.callback}
      afterSignOutUrl={AUTH.login}
    >
      <ConvexProviderWithAuth client={clientFor(url)} useAuth={useRecordAuth}>
        {children}
      </ConvexProviderWithAuth>
    </ClerkProvider>
  );
}
