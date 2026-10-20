import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import type { Tone } from "@/lib/ui/status-tone";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-5 w-fit max-w-full shrink-0 items-center gap-1.5 overflow-hidden rounded-full px-2 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        success:
          "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
        warning:
          "bg-amber-500/12 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
        danger: "bg-destructive/10 text-destructive dark:bg-destructive/20",
        info: "bg-primary/10 text-primary dark:bg-primary/20",
        neutral: "bg-muted text-muted-foreground",
      } satisfies Record<Tone, string>,
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

/** A status: tone encodes meaning (not module), always with a dot, never an icon. */
function Badge({
  className,
  tone = "neutral",
  children,
  ...props
}: Omit<React.ComponentProps<"span">, "tone"> &
  VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      data-tone={tone}
      className={cn(badgeVariants({ tone }), className)}
      {...props}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A category or resource type (Contrato, Persona, Laptop): no dot, no tone. */
function Tag({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="tag"
      className={cn(
        "border-border text-muted-foreground inline-flex h-5 w-fit max-w-full shrink-0 items-center truncate rounded-md border px-1.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

export { Badge, Tag, badgeVariants };
