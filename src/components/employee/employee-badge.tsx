import type { ReactNode } from "react";

import { WorkiaMark } from "@/components/brand/workia-mark";
import { cn } from "@/lib/utils";

/** The login badge of /login, for the employee screens (W2-01). */
export const EmployeeBadge = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <div className="login-badge-shadow w-full">
    <div className="login-badge">
      <div className="px-[30px] pt-2 pb-7 max-[400px]:px-[22px]">
        <div className="mb-[22px] flex items-center gap-2.5">
          <WorkiaMark />
          <span className="text-[17px] font-bold tracking-[-0.01em] text-[color:var(--login-ink)]">
            workia
          </span>
        </div>
        <h1 className="mb-1.5 text-[22px] font-semibold tracking-[-0.015em] text-[color:var(--login-ink)] sm:text-[25px]">
          {title}
        </h1>
        <p className="mb-[26px] text-[13.5px] leading-normal text-[color:var(--login-ink-muted)]">
          {description}
        </p>
        {children}
      </div>
    </div>
  </div>
);

export const fieldLabelClassName =
  "mb-2 block font-mono text-[10.5px] font-medium tracking-[0.09em] text-[color:var(--login-ink-faint)] uppercase";

export const fieldInputClassName = cn(
  "w-full border-0 border-b-[1.5px] border-[color:var(--login-line-strong)] bg-transparent px-0.5 py-2.5 text-[14.5px] text-[color:var(--login-ink)] shadow-none outline-none",
  "placeholder:text-[color:var(--login-ink-faint)]",
  "focus-visible:border-transparent focus-visible:ring-0",
);

export const primaryButtonClassName =
  "login-stamp-btn min-h-11 w-full rounded-lg px-0 py-3.5 text-[15px] font-semibold tracking-[0.01em] focus-visible:ring-2 focus-visible:ring-[color:var(--login-accent-violet)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--login-badge-a)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-80";

export const secondaryButtonClassName =
  "min-h-11 w-full rounded-lg border border-[color:var(--login-line-strong)] px-0 py-3 text-[14.5px] font-medium text-[color:var(--login-ink)] hover:bg-[color:var(--login-line)] focus-visible:ring-2 focus-visible:ring-[color:var(--login-accent-violet)] focus-visible:outline-none";

export const FieldError = ({ message }: { message?: string | null }) =>
  message ? (
    <p className="text-sm text-red-500" role="alert">
      {message}
    </p>
  ) : null;
