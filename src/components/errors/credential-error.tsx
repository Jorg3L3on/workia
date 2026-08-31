import Link from "next/link";

import { LoginStage } from "@/components/auth/login-stage";
import { WorkiaMark } from "@/components/brand/workia-mark";
import { errorCopy } from "@/lib/brand/chrome-copy";

type CredentialErrorProps = {
  code: "404" | "403";
  stamp: string;
  title: string;
  description: string;
};

export const CredentialError = ({
  code,
  stamp,
  title,
  description,
}: CredentialErrorProps) => {
  return (
    <LoginStage>
      <div className="login-badge-shadow w-full">
        <div className="login-badge" data-testid={`credential-error-${code}`}>
          <div className="login-badge-slot" aria-hidden />

          <div className="px-[30px] pt-2 pb-1 max-[400px]:px-[22px]">
            <div className="mb-[22px] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <WorkiaMark />
                <span className="text-[17px] font-bold tracking-[-0.01em] text-[color:var(--login-ink)]">
                  workia
                </span>
              </div>
              <span
                className="rounded border border-[color:var(--login-line)] px-2.5 py-1 font-mono text-[11px] tracking-[0.05em] text-[color:var(--login-ink-faint)]"
                aria-hidden
              >
                {stamp}
              </span>
            </div>

            <p className="mb-2 font-mono text-[10.5px] font-medium tracking-[0.09em] text-[color:var(--login-ink-faint)] uppercase">
              Credencial
            </p>
            <h1 className="mb-1.5 text-[22px] font-semibold tracking-[-0.015em] text-[color:var(--login-ink)] sm:text-[25px]">
              {title}
            </h1>
            <p className="mb-[26px] text-[13.5px] leading-normal text-[color:var(--login-ink-muted)]">
              {description}
            </p>

            <Link
              href="/app"
              className="login-stamp-btn mt-1.5 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-0 py-3.5 text-[15px] font-semibold tracking-[0.01em] transition-[transform,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-[color:var(--login-accent-violet)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--login-badge-a)] focus-visible:outline-none"
            >
              {errorCopy.backToHome}
            </Link>
          </div>
        </div>
      </div>
    </LoginStage>
  );
};
