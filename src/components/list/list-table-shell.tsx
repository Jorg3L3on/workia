import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Dense dashboard list table styling (Zigzag-aligned). */
export const listTableDensityClassName =
  "[&_td]:py-3 [&_td]:align-middle [&_th]:h-10 [&_th]:bg-muted/40 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:tracking-wide [&_th]:text-muted-foreground [&_th]:uppercase [&_th]:py-2 [&_th]:align-middle [&_tr]:border-border/60 [&_td]:px-3";

type ListTableShellProps = {
  children: ReactNode;
  className?: string;
  /** Hide on small screens when paired with mobile cards. */
  desktopOnly?: boolean;
};

export const ListTableShell = ({
  children,
  className,
  desktopOnly = false,
}: ListTableShellProps) => (
  <div
    className={cn(
      "border-border/70 bg-card overflow-hidden rounded-xl border shadow-sm",
      desktopOnly && "hidden md:block",
      className,
    )}
  >
    {children}
  </div>
);

type ListEmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export const ListEmptyState = ({
  title,
  description,
  action,
  className,
}: ListEmptyStateProps) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center px-6 py-12 text-center",
      className,
    )}
  >
    <p className="text-sm font-medium">{title}</p>
    {description ? (
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">
        {description}
      </p>
    ) : null}
    {action ? <div className="mt-4">{action}</div> : null}
  </div>
);

type ListResultCountProps = {
  count: number;
  singular: string;
  plural: string;
  className?: string;
};

export const ListResultCount = ({
  count,
  singular,
  plural,
  className,
}: ListResultCountProps) => (
  <p className={cn("text-muted-foreground text-xs tabular-nums", className)}>
    {count} {count === 1 ? singular : plural}
  </p>
);
