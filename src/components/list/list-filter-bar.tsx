import type { FormHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type ListFilterBarProps = FormHTMLAttributes<HTMLFormElement> & {
  children: ReactNode;
  footer?: ReactNode;
};

export const ListFilterBar = ({
  children,
  className,
  footer,
  ...props
}: ListFilterBarProps) => (
  <div className="space-y-3">
    <form
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end",
        className,
      )}
      {...props}
    >
      {children}
    </form>
    {footer}
  </div>
);

/** Shared select chrome for list toolbars (Zigzag-like compact filters). */
export const listFilterSelectClassName =
  "border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-xl border px-3 text-sm outline-none focus-visible:ring-3";
