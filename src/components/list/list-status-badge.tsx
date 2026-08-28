import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ListStatusTone = "active" | "inactive" | "neutral" | "destructive";

const toneClassNames: Record<ListStatusTone, string> = {
  active: "border-border/70 bg-muted/50 text-foreground",
  inactive: "bg-muted text-muted-foreground",
  neutral: "border-border/70 bg-transparent text-muted-foreground",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
};

type ListStatusBadgeProps = ComponentProps<typeof Badge> & {
  tone?: ListStatusTone;
};

export const ListStatusBadge = ({
  tone = "neutral",
  className,
  variant = "outline",
  ...props
}: ListStatusBadgeProps) => (
  <Badge
    className={cn("font-normal", toneClassNames[tone], className)}
    variant={variant}
    {...props}
  />
);
