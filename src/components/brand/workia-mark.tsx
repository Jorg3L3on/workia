import { cn } from "@/lib/utils";

type WorkiaMarkProps = {
  className?: string;
};

/** Ribbon-style W isotipo — blue-to-violet gradient, no background tile. */
export const WorkiaMark = ({ className }: WorkiaMarkProps) => {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-8 w-8 shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient
          id="workia-mark-gradient"
          x1="8"
          y1="8"
          x2="56"
          y2="56"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4FACFE" />
          <stop offset="0.5" stopColor="#6B8CF8" />
          <stop offset="1" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <path
        d="M 8 52 C 8 52 12 16 24 16 C 30 16 32 40 32 44 C 32 40 34 16 40 16 C 52 16 56 52 56 52"
        stroke="url(#workia-mark-gradient)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
