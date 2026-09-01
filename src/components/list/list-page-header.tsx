import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ListPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  descriptionSecondary?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/** Zigzag-aligned list page header: title block + solid blue primary actions. */
export const ListPageHeader = ({
  eyebrow,
  title,
  description,
  descriptionSecondary,
  actions,
  className,
}: ListPageHeaderProps) => (
  <header
    className={cn(
      "flex flex-wrap items-start justify-between gap-4",
      className,
    )}
  >
    <div className="min-w-0 space-y-1">
      {eyebrow ? (
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        {title}
      </h1>
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
      {descriptionSecondary ? (
        <p className="text-muted-foreground text-sm">{descriptionSecondary}</p>
      ) : null}
    </div>
    {actions ? (
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {actions}
      </div>
    ) : null}
  </header>
);

/** Solid blue pill CTA used on authenticated list pages. */
export const listPrimaryActionClassName =
  "h-10 rounded-full border-0 bg-primary px-4 text-primary-foreground shadow-sm hover:bg-[color:var(--workia-accent-blue-hover)]";
