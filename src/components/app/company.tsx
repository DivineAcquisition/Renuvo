"use client";

import { createContext, useContext } from "react";

import type { Id } from "../../../convex/_generated/dataModel";

export type Role = "owner" | "manager" | "office";
export type Company = { companyId: Id<"companies">; name: string; timezone: string; role: Role };

const CompanyContext = createContext<Company | null>(null);

export function CompanyProvider({ company, children }: { company: Company; children: React.ReactNode }) {
  return <CompanyContext.Provider value={company}>{children}</CompanyContext.Provider>;
}

/** The company the signed-in person is working in. Every query and mutation takes its id. */
export function useCompany(): Company {
  const company = useContext(CompanyContext);
  if (!company) throw new Error("useCompany needs a CompanyProvider");
  return company;
}

export const canManage = (role: Role) => role === "owner" || role === "manager";
