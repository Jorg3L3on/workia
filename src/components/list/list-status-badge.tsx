import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ListStatusTone = "active" | "inactive" | "neutral" | "destructive";

const toneClassNames: Record<ListStatusTone, string> = {
  active:
    "border-transparent bg-transparent px-0 text-[color:var(--workia-success)]",
  inactive: "border-border/70 bg-muted text-muted-foreground",
  neutral: "border-border/70 bg-transparent text-muted-foreground",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
};

const toneDotClassNames: Record<ListStatusTone, string | null> = {
  active: "bg-[color:var(--workia-success)]",
  inactive: "bg-muted-foreground/50",
  neutral: null,
  destructive: "bg-destructive",
};

type ListStatusBadgeProps = ComponentProps<typeof Badge> & {
  tone?: ListStatusTone;
};

export const ListStatusBadge = ({
  tone = "neutral",
  className,
  variant = "outline",
  children,
  ...props
}: ListStatusBadgeProps) => {
  const dotClassName = toneDotClassNames[tone];

  return (
    <Badge
      className={cn(
        "inline-flex items-center gap-1.5 font-medium",
        toneClassNames[tone],
        className,
      )}
      variant={variant}
      {...props}
    >
      {dotClassName ? (
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", dotClassName)}
        />
      ) : null}
      {children}
    </Badge>
  );
};
