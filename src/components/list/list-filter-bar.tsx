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
  <div className="space-y-2">
    <form
      className={cn(
        "border-border/70 bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-end",
        className,
      )}
      {...props}
    >
      {children}
    </form>
    {footer}
  </div>
);
