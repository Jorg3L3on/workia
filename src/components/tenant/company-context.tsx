"use client";

import { createContext, useContext, type ReactNode } from "react";

import { COMPANY_FIELD } from "@/lib/tenant/scope";

export type ActiveCompany = { id: string; name: string };

const CompanyContext = createContext<ActiveCompany | null>(null);

/** The company the screen was rendered in; forms send it back with every write. */
export const CompanyProvider = ({
  company,
  children,
}: {
  company: ActiveCompany;
  children: ReactNode;
}) => (
  <CompanyContext.Provider value={company}>{children}</CompanyContext.Provider>
);

export const useActiveCompany = () => useContext(CompanyContext);

/**
 * Hidden field with the company this form was opened in. If another tab
 * switched company meanwhile, the action refuses the write instead of saving
 * it into the wrong company.
 */
export const CompanyField = () => {
  const company = useActiveCompany();

  return company ? (
    <input type="hidden" name={COMPANY_FIELD} value={company.id} />
  ) : null;
};
