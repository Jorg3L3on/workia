import Link from "next/link";
import type { ReactNode } from "react";

import { WorkflowRibbon } from "@/components/auth/workflow-ribbon";
import { WorkiaMark } from "@/components/brand/workia-mark";
import { cn } from "@/lib/utils";

type LoginStageProps = {
  children: ReactNode;
  className?: string;
};

/** Aurora glass shell + two-column panel for the login experience. */
export const LoginStage = ({ children, className }: LoginStageProps) => {
  return (
    <div
      className={cn(
        "dark relative flex min-h-svh items-center justify-center overflow-x-hidden bg-[#060914] px-5 py-8 text-[#f7f8ff]",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.045] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <div
        aria-hidden
        className="pointer-events-none fixed inset-[-20%] z-0 animate-[login-aurora-drift_26s_ease-in-out_infinite_alternate] opacity-55 blur-[90px] motion-reduce:animate-none"
      >
        <div className="absolute top-[12%] left-[8%] h-[42vw] max-h-[520px] w-[42vw] max-w-[520px] rounded-full bg-[radial-gradient(circle,#4FACFE_0%,transparent_70%)] opacity-40" />
        <div className="absolute right-[6%] bottom-[8%] h-[46vw] max-h-[560px] w-[46vw] max-w-[560px] rounded-full bg-[radial-gradient(circle,#8B5CF6_0%,transparent_70%)] opacity-30" />
      </div>

      <div className="relative z-[1] w-full max-w-[880px]">
        <div className="relative grid overflow-hidden rounded-3xl border border-white/[0.09] bg-[rgba(20,20,27,0.55)] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.02)_inset] backdrop-blur-[28px] backdrop-saturate-150 max-[780px]:mx-auto max-[780px]:max-w-[420px] max-[780px]:grid-cols-1 min-[781px]:grid-cols-2">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-3xl p-px"
            style={{
              background:
                "linear-gradient(135deg, rgba(79,172,254,0.45), transparent 30%, transparent 70%, rgba(139,92,246,0.4))",
              WebkitMask:
                "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
              WebkitMaskComposite: "xor",
              maskComposite: "exclude",
            }}
          />

          <aside className="relative flex flex-col border-b border-white/[0.09] bg-linear-to-b from-[#4FACFE]/[0.08] to-[#8B5CF6]/[0.06] px-7 pt-8 pb-7 max-[780px]:gap-7 min-[781px]:justify-between min-[781px]:border-r min-[781px]:border-b-0 min-[781px]:px-10 min-[781px]:py-12">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 font-semibold tracking-tight text-[#f4f3f8]"
              aria-label="workia home"
            >
              <WorkiaMark className="h-8 w-8" />
              <span className="text-base">workia</span>
            </Link>

            <div className="min-[781px]:mt-10">
              <p className="mb-3.5 text-[11px] font-semibold tracking-[0.14em] text-[#55535f] uppercase">
                Welcome back
              </p>
              <p className="max-w-[260px] text-[26px] leading-[1.25] font-semibold tracking-tight text-[#f4f3f8]">
                Your work,{" "}
                <em className="bg-linear-to-br from-[#4FACFE] to-[#8B5CF6] bg-clip-text text-transparent not-italic">
                  flowing
                </em>{" "}
                seamlessly.
              </p>
            </div>

            <WorkflowRibbon className="max-[780px]:mt-0 min-[781px]:mt-10" />
          </aside>

          <div className="relative flex flex-col px-7 py-8 max-[780px]:pt-8 sm:px-11 sm:py-12">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
