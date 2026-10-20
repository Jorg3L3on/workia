"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type IconButtonProps = Omit<React.ComponentProps<typeof Button>, "size"> & {
  /** Shown as the tooltip and used as the accessible name. */
  label: string;
  size?: "icon" | "icon-xs" | "icon-sm" | "icon-lg";
};

/** An icon-only button: always carries a tooltip and an aria-label. */
function IconButton({
  label,
  size = "icon",
  variant = "ghost",
  ...props
}: IconButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button aria-label={label} size={size} variant={variant} {...props} />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { IconButton };
