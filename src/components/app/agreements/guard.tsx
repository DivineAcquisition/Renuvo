"use client";

import { Guard } from "@/components/app/settings/guard";

import { Empty } from "@/components/app/agreements/shared";

/** A document that is not there, or that this role may not see, reads the same: not available. */
export function AgreementGuard({ children }: { children: React.ReactNode }) {
  return (
    <Guard
      fallback={() => (
        <Empty title="This isn't available">
          The agreement doesn&apos;t exist, or your role doesn&apos;t include it. If you think it should, ask the company&apos;s Owner.
        </Empty>
      )}
    >
      {children}
    </Guard>
  );
}
