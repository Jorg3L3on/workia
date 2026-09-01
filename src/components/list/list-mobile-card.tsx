"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

type ListMobileCardProps = {
  href: string;
  ariaLabel: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export const ListMobileCard = ({
  href,
  ariaLabel,
  children,
  actions,
  className,
}: ListMobileCardProps) => {
  const router = useRouter();

  const handleNavigate = () => {
    router.push(href);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(href);
    }
  };

  return (
    <article
      aria-label={ariaLabel}
      className={cn(
        "border-border/60 bg-card hover:bg-muted/30 rounded-2xl border p-4 shadow-sm transition-colors",
        className,
      )}
      role="button"
      tabIndex={0}
      onClick={handleNavigate}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">{children}</div>
        {actions ? (
          <div
            className="shrink-0"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </article>
  );
};
