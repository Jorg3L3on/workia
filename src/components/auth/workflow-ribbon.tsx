"use client";

import { useId, useMemo } from "react";

import { cn } from "@/lib/utils";

type WorkflowRibbonProps = {
  className?: string;
};

const MILESTONES = [
  { key: "capture", label: "Capture", x: 24, active: false },
  { key: "focus", label: "Focus", x: 150, active: true },
  { key: "deliver", label: "Deliver", x: 276, active: false },
] as const;

/** Animated workflow timeline — ribbon path with pulsing active milestone. */
export const WorkflowRibbon = ({ className }: WorkflowRibbonProps) => {
  const reactId = useId();
  const gradientId = `workflowGrad-${reactId.replace(/:/g, "")}`;

  const ribbonPath = useMemo(
    () => "M 24 28 C 60 28 90 12 150 12 C 210 12 240 28 276 28",
    [],
  );

  return (
    <div
      className={cn(className)}
      role="img"
      aria-label="Workflow: Capture, Focus, Deliver"
    >
      <div className="mb-3.5 flex items-baseline justify-between">
        <span className="text-xs text-[#8b899a]">Your flow</span>
        <span className="font-mono text-xs font-medium text-[#f4f3f8]">
          In progress
        </span>
      </div>
      <svg
        className="block h-16 w-full overflow-visible"
        viewBox="0 0 300 48"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4FACFE" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>

        <path
          d={ribbonPath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.35"
        />

        <path
          d={ribbonPath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="320"
          strokeDashoffset="320"
          className="motion-safe:animate-[login-ribbon-draw_3s_ease-out_forwards]"
        />

        {MILESTONES.map((node) => (
          <g key={node.key} transform={`translate(${node.x}, 28)`}>
            {node.active ? (
              <>
                <circle
                  r="10"
                  fill="none"
                  stroke="#8B5CF6"
                  strokeWidth="1.5"
                  opacity="0.5"
                  className="motion-safe:origin-center motion-safe:animate-[login-pulse-ring_2.4s_ease-out_infinite]"
                />
                <circle
                  r="5"
                  fill="#8B5CF6"
                  className="motion-safe:origin-center motion-safe:animate-[login-pulse-breathe_2.4s_ease-in-out_infinite]"
                />
              </>
            ) : (
              <circle r="4" fill={`url(#${gradientId})`} opacity="0.85" />
            )}
          </g>
        ))}
      </svg>

      <div className="mt-2 flex justify-between px-0.5">
        {MILESTONES.map((node) => (
          <span
            key={node.key}
            className={cn(
              "text-[10px] tracking-wide uppercase",
              node.active ? "font-semibold text-[#f4f3f8]" : "text-[#55535f]",
            )}
          >
            {node.label}
          </span>
        ))}
      </div>
    </div>
  );
};
