import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Dense product list table styling (Zigzag tickets/clients aligned). */
export const listTableDensityClassName =
  "[&_td]:py-3.5 [&_td]:align-middle [&_th]:h-11 [&_th]:bg-muted/50 [&_th]:px-4 [&_th]:text-sm [&_th]:font-medium [&_th]:text-muted-foreground [&_th]:py-2.5 [&_th]:align-middle [&_tr]:border-border/50 [&_td]:px-4";

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
      "border-border/60 bg-card overflow-hidden rounded-2xl border shadow-sm",
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
  total?: number;
  className?: string;
};

export const ListResultCount = ({
  count,
  singular,
  plural,
  total,
  className,
}: ListResultCountProps) => {
  const showingPartial = total != null && total !== count;
  const label = !showingPartial && count === 1 ? singular : plural;
  const text = showingPartial
    ? `${count} de ${total} ${label}`
    : `${count} ${label}`;

  return (
    <p
      className={cn(
        "bg-muted text-muted-foreground inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium tabular-nums",
        className,
      )}
    >
      {text}
    </p>
  );
};
