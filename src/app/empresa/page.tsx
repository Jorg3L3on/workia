import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginStage } from "@/components/auth/login-stage";
import { WorkiaMark } from "@/components/brand/workia-mark";
import { CompanyPicker } from "@/components/tenant/company-picker";
import { SignOutButton } from "@/components/tenant/sign-out-button";
import { companyCopy, pageTitles } from "@/lib/brand/chrome-copy";
import { getSession } from "@/lib/auth/session";
import { getCompanyContext } from "@/lib/tenant/context";
import { listActiveMemberships } from "@/lib/tenant/memberships";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.empresa,
};

/** Where /app sends a user without an active company: pick one, or learn there is none. */
export default async function EmpresaPage() {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=%2Fempresa");
  }

  const memberships = await listActiveMemberships(session.user.id);
  const hasCompany = memberships.length > 0;

  // Someone who can already act in a company and lands here by hand still gets the picker.
  const context = hasCompany ? await getCompanyContext() : null;

  return (
    <LoginStage>
      <div className="login-badge-shadow w-full">
        <div
          className="login-badge"
          data-testid={hasCompany ? "company-picker" : "no-company"}
        >
          <div className="px-[30px] pt-2 pb-1 max-[400px]:px-[22px]">
            <div className="mb-[22px] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <WorkiaMark />
                <span className="text-[17px] font-bold tracking-[-0.01em] text-[color:var(--login-ink)]">
                  workia
                </span>
              </div>
              {hasCompany ? null : (
                <span
                  className="rounded border border-[color:var(--login-line)] px-2.5 py-1 font-mono text-[11px] tracking-[0.05em] text-[color:var(--login-ink-faint)]"
                  aria-hidden
                >
                  {companyCopy.noCompanyStamp}
                </span>
              )}
            </div>

            <p className="mb-2 font-mono text-[10.5px] font-medium tracking-[0.09em] text-[color:var(--login-ink-faint)] uppercase">
              {companyCopy.pickerEyebrow}
            </p>
            <h1 className="mb-1.5 text-[22px] font-semibold tracking-[-0.015em] text-[color:var(--login-ink)] sm:text-[25px]">
              {hasCompany
                ? companyCopy.pickerTitle
                : companyCopy.noCompanyTitle}
            </h1>
            <p className="mb-[22px] text-[13.5px] leading-normal text-[color:var(--login-ink-muted)]">
              {hasCompany
                ? companyCopy.pickerDescription
                : companyCopy.noCompanyDescription}
            </p>

            {hasCompany ? (
              <CompanyPicker
                companies={memberships.map((membership) => ({
                  id: membership.companyId,
                  name:
                    membership.companyId === context?.companyId
                      ? `${membership.companyName} (actual)`
                      : membership.companyName,
                  roleName: membership.roleName,
                }))}
              />
            ) : (
              <SignOutButton />
            )}
          </div>
        </div>
      </div>
    </LoginStage>
  );
}
