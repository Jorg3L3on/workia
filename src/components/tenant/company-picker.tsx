"use client";

import { useActionState } from "react";
import { Building2Icon, ChevronRightIcon } from "lucide-react";

import { companyCopy } from "@/lib/brand/chrome-copy";
import {
  switchCompanyAction,
  type SwitchCompanyState,
} from "@/lib/tenant/actions";

type CompanyPickerProps = {
  companies: { id: string; name: string; roleName: string }[];
};

export const CompanyPicker = ({ companies }: CompanyPickerProps) => {
  const [state, formAction, pending] = useActionState<
    SwitchCompanyState,
    FormData
  >(switchCompanyAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {companies.map((company) => (
        <button
          key={company.id}
          type="submit"
          name="companyId"
          value={company.id}
          disabled={pending}
          className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-[color:var(--login-line)] px-4 py-3 text-left transition-colors hover:bg-[color:var(--login-line)]/40 focus-visible:ring-2 focus-visible:ring-[color:var(--login-accent-violet)] focus-visible:outline-none disabled:opacity-60"
        >
          <Building2Icon
            className="size-5 shrink-0 text-[color:var(--login-ink-muted)]"
            aria-hidden
          />
          <span className="grid flex-1">
            <span className="text-[15px] font-semibold text-[color:var(--login-ink)]">
              {company.name}
            </span>
            <span className="text-[12.5px] text-[color:var(--login-ink-muted)]">
              {company.roleName}
            </span>
          </span>
          <ChevronRightIcon
            className="size-4 text-[color:var(--login-ink-faint)]"
            aria-hidden
          />
        </button>
      ))}
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
};
