"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";

import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ClickableTableRowProps = {
  href: string;
  children: ReactNode;
  className?: string;
  ariaLabel: string;
};

export const ClickableTableRow = ({
  href,
  children,
  className,
  ariaLabel,
}: ClickableTableRowProps) => {
  const router = useRouter();

  const handleNavigate = () => {
    router.push(href);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(href);
    }
  };

  return (
    <TableRow
      aria-label={ariaLabel}
      className={cn("cursor-pointer", className)}
      role="link"
      tabIndex={0}
      onClick={handleNavigate}
      onKeyDown={handleKeyDown}
    >
      {children}
    </TableRow>
  );
};
