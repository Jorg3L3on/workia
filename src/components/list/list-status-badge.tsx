"use client";

import type { ReactNode } from "react";

import {
  AnimatedBadge,
  type AnimatedBadgeStatus,
} from "@/components/motion/animated-badge";
import { cn } from "@/lib/utils";

type ListStatusTone = "active" | "inactive" | "neutral" | "destructive";

const toneToStatus: Record<ListStatusTone, AnimatedBadgeStatus> = {
  active: "success",
  inactive: "neutral",
  neutral: "neutral",
  destructive: "danger",
};

type ListStatusBadgeProps = {
  tone?: ListStatusTone;
  className?: string;
  children: ReactNode;
};

export const ListStatusBadge = ({
  tone = "neutral",
  className,
  children,
}: ListStatusBadgeProps) => (
  <AnimatedBadge
    className={cn("max-w-full", className)}
    showIcon
    size="sm"
    status={toneToStatus[tone]}
  >
    {children}
  </AnimatedBadge>
);
