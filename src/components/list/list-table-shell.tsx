import { InboxIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

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
      "border-border/60 bg-card overflow-hidden rounded-lg border",
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
  <Empty className={cn("border-0 py-12", className)}>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <InboxIcon />
      </EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      {description ? <EmptyDescription>{description}</EmptyDescription> : null}
    </EmptyHeader>
    {action ? <EmptyContent>{action}</EmptyContent> : null}
  </Empty>
);
