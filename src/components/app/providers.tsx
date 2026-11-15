"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { APP_PATH, clerkPublishableKey, convexUrl, SIGN_IN_PATH, SIGN_UP_PATH } from "@/lib/app/config";

const clients = new Map<string, ConvexReactClient>();

function clientFor(url: string) {
  const existing = clients.get(url);
  if (existing) return existing;
  const client = new ConvexReactClient(url);
  clients.set(url, client);
  return client;
}

/** Sign-in (Clerk) and the live record (Convex), for the product only. The public page loads neither. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  const key = clerkPublishableKey();
  const url = convexUrl();
  if (!key || !url) return children;
  return (
    <ClerkProvider
      publishableKey={key}
      signInUrl={SIGN_IN_PATH}
      signUpUrl={SIGN_UP_PATH}
      signInFallbackRedirectUrl={APP_PATH}
      signUpFallbackRedirectUrl={APP_PATH}
      afterSignOutUrl="/"
      appearance={{ theme: shadcn }}
    >
      <ConvexProviderWithClerk client={clientFor(url)} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
