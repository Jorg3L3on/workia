"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ListRowActionProps = {
  href: string;
  children: React.ReactNode;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  onClick?: (event: React.MouseEvent) => void;
  "aria-label"?: string;
};

export const ListRowAction = ({
  href,
  children,
  className,
  variant = "ghost",
  onClick,
  "aria-label": ariaLabel,
}: ListRowActionProps) => (
  <Button
    asChild
    className={cn(
      "h-8 rounded-full px-3 text-xs font-medium shadow-none",
      className,
    )}
    size="sm"
    variant={variant}
  >
    <Link
      aria-label={ariaLabel}
      href={href}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    >
      {children}
    </Link>
  </Button>
);
