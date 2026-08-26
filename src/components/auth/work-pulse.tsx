"use client";

import { useId, useMemo } from "react";

import {
  dayToWeekPulseX,
  formatWeekdayLabel,
  getWeekdayIndex,
} from "@/components/auth/work-pulse-geometry";
import { cn } from "@/lib/utils";

type WorkPulseProps = {
  className?: string;
  now?: Date;
};

const WEEK_DAYS = 7;
const NODE_DAYS = [1, 4] as const;

/** Work-week timeline — amber node marks today, mirroring micasa's fortnight pulse. */
export const WorkPulse = ({ className, now = new Date() }: WorkPulseProps) => {
  const reactId = useId();
  const gradientId = `workPulseGrad-${reactId.replace(/:/g, "")}`;

  const { todayIndex, todayLabel, ticks } = useMemo(() => {
    const today = getWeekdayIndex(now);
    const tickDays: number[] = [];

    for (let day = 1; day <= WEEK_DAYS; day += 1) {
      if (
        day === today ||
        NODE_DAYS.includes(day as (typeof NODE_DAYS)[number])
      ) {
        continue;
      }
      tickDays.push(day);
    }

    return {
      todayIndex: today,
      todayLabel: formatWeekdayLabel(now),
      ticks: tickDays,
    };
  }, [now]);

  const todayX = dayToWeekPulseX(todayIndex, WEEK_DAYS);

  return (
    <div
      className={cn(className)}
      role="img"
      aria-label={`Today: ${todayLabel}`}
    >
      <div className="mb-3.5 flex items-baseline justify-between">
        <span className="text-xs text-[#8b899a]">This week</span>
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
        {ticks.map((day) => {
          const cx = dayToWeekPulseX(day, WEEK_DAYS);
          const major = day === 7;
          return (
            <rect
              key={day}
              x={cx - 0.5}
              y={major ? 17 : 18.5}
              width={1}
              height={major ? 6 : 3}
              fill="rgba(255,255,255,0.16)"
            />
          );
        })}
        {NODE_DAYS.map((day) => (
          <circle
            key={day}
            cx={dayToWeekPulseX(day, WEEK_DAYS)}
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
        <span className="text-[10px] text-[#55535f]">Mon</span>
        <span className="text-[10px] text-[#55535f]">Thu</span>
        <span className="text-[10px] text-[#55535f]">Sun</span>
      </div>
    </div>
  );
};
