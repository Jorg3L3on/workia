import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

type LoginStageProps = {
  children: ReactNode;
  className?: string;
};

/** Centered credential stage — atmosphere from the family, layout of its own. */
export const LoginStage = ({ children, className }: LoginStageProps) => {
  return (
    <div
      className={cn(
        "login-surface relative flex min-h-svh flex-col items-center justify-center overflow-x-hidden px-5 py-12",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div
          className="login-ambient-blob"
          style={{
            width: 420,
            height: 420,
            background: "var(--login-accent-blue)",
            top: -140,
            left: -120,
          }}
        />
        <div
          className="login-ambient-blob login-ambient-blob-b"
          style={{
            width: 380,
            height: 380,
            background: "var(--login-accent-violet)",
            bottom: -160,
            right: -100,
          }}
        />
      </div>
      <div
        className="login-grain pointer-events-none absolute inset-0 z-[1]"
        aria-hidden
      />

      <div className="fixed top-6 right-6 z-10">
        <ThemeToggle />
      </div>

      <div className="relative z-[2] flex w-full max-w-[420px] flex-col items-center gap-[18px]">
        {children}
        <p className="font-mono text-[11px] tracking-[0.04em] text-[color:var(--login-ink-faint)]">
          Hecho para{" "}
          <strong className="font-semibold text-[color:var(--login-ink-muted)]">
            RRHH
          </strong>
        </p>
      </div>
    </div>
  );
};
