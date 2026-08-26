"use client";

import { useId, useMemo } from "react";

import {
  dayToPulseX,
  daysInCalendarMonth,
  formatPayrollDateLabel,
} from "@/components/auth/work-pulse-geometry";
import { cn } from "@/lib/utils";

type WorkPulseProps = {
  className?: string;
  now?: Date;
};

const PAYROLL_NODE_DAYS = [1, 16] as const;

/** Payroll-cycle timeline — amber node = today, matching micasa's fortnight pulse. */
export const WorkPulse = ({ className, now = new Date() }: WorkPulseProps) => {
  const reactId = useId();
  const gradientId = `payrollGrad-${reactId.replace(/:/g, "")}`;

  const { day, daysInMonth, todayLabel, ticks } = useMemo(() => {
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const currentDay = now.getDate();
    const days = daysInCalendarMonth(year, month);
    const tickDays: number[] = [];

    for (let d = 1; d <= days; d += 1) {
      if (d === currentDay || PAYROLL_NODE_DAYS.includes(d as 1 | 16)) {
        continue;
      }
      tickDays.push(d);
    }

    return {
      day: currentDay,
      daysInMonth: days,
      todayLabel: formatPayrollDateLabel(now),
      ticks: tickDays,
    };
  }, [now]);

  const todayX = dayToPulseX(day, daysInMonth);

  return (
    <div className={cn(className)} role="img" aria-label={`Hoy: ${todayLabel}`}>
      <div className="mb-3.5 flex items-baseline justify-between">
        <span className="text-xs text-[#8b899a]">Nómina</span>
        <span className="font-mono text-xs font-medium text-[#f4f3f8]">
          {todayLabel}
        </span>
      </div>
      <svg
        className="block h-16 w-full overflow-visible"
        viewBox="0 0 300 40"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#4FACFE" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <line
          x1="4"
          y1="20"
          x2="296"
          y2="20"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="1.5"
          opacity="0.55"
        />
        {ticks.map((tickDay) => {
          const cx = dayToPulseX(tickDay, daysInMonth);
          const major = tickDay % 5 === 0;
          return (
            <rect
              key={tickDay}
              x={cx - 0.5}
              y={major ? 17 : 18.5}
              width={1}
              height={major ? 6 : 3}
              fill="rgba(255,255,255,0.16)"
            />
          );
        })}
        {PAYROLL_NODE_DAYS.map((nodeDay) => (
          <circle
            key={nodeDay}
            cx={dayToPulseX(nodeDay, daysInMonth)}
            cy={20}
            r={3.2}
            fill={`url(#${gradientId})`}
          />
        ))}
        <circle
          cx={todayX}
          cy={20}
          r={5}
          fill="none"
          stroke="#ffb454"
          strokeWidth={1}
          className="origin-center animate-[login-pulse-ring_2.6s_ease-in-out_infinite] motion-reduce:animate-none"
          style={{ transformBox: "fill-box" }}
          opacity={0.5}
        />
        <circle
          cx={todayX}
          cy={20}
          r={3.6}
          fill="#ffb454"
          className="origin-center animate-[login-pulse-breathe_2.6s_ease-in-out_infinite] motion-reduce:animate-none"
          style={{ transformBox: "fill-box" }}
        />
      </svg>
      <div className="mt-1.5 flex justify-between">
        <span className="text-[10px] text-[#55535f]">1</span>
        <span className="text-[10px] text-[#55535f]">16</span>
        <span className="text-[10px] text-[#55535f]">{daysInMonth}</span>
      </div>
    </div>
  );
};
