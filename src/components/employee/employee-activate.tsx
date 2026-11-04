"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  activateAccountAction,
  type EmployeeSignInState,
} from "@/lib/employee/actions";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";

import {
  FieldError,
  fieldInputClassName,
  fieldLabelClassName,
  primaryButtonClassName,
} from "./employee-badge";

/**
 * /mi/activar (W2-01): a person without email types the code HR gave them
 * and their CURP, then chooses a password. The same form resets a password
 * when HR issues a new code.
 */
export const EmployeeActivate = () => {
  const [state, action, pending] = useActionState<
    EmployeeSignInState,
    FormData
  >(activateAccountAction, {});

  return (
    <form action={action} className="space-y-5" noValidate>
      <div>
        <label className={fieldLabelClassName} htmlFor="activation-curp">
          CURP
        </label>
        <div className="login-input-line">
          <input
            autoCapitalize="characters"
            autoComplete="username"
            className={cn(fieldInputClassName, "uppercase")}
            id="activation-curp"
            maxLength={18}
            name="curp"
            required
          />
        </div>
      </div>
      <div>
        <label className={fieldLabelClassName} htmlFor="activation-code">
          Código de activación
        </label>
        <div className="login-input-line">
          <input
            autoCapitalize="characters"
            autoComplete="one-time-code"
            className={cn(fieldInputClassName, "tracking-[0.15em] uppercase")}
            id="activation-code"
            name="code"
            placeholder="XXXX-XXXX-XXXX"
            required
          />
        </div>
      </div>
      <div>
        <label className={fieldLabelClassName} htmlFor="activation-password">
          Nueva contraseña
        </label>
        <div className="login-input-line">
          <PasswordInput
            autoComplete="new-password"
            className={cn(fieldInputClassName, "pr-9")}
            id="activation-password"
            minLength={8}
            name="password"
            required
          />
        </div>
        <p className="mt-1.5 text-xs text-[color:var(--login-ink-faint)]">
          Al menos 8 caracteres.
        </p>
      </div>
      <div>
        <label className={fieldLabelClassName} htmlFor="activation-confirm">
          Repite la contraseña
        </label>
        <div className="login-input-line">
          <PasswordInput
            autoComplete="new-password"
            className={cn(fieldInputClassName, "pr-9")}
            id="activation-confirm"
            minLength={8}
            name="confirm"
            required
          />
        </div>
      </div>
      <FieldError message={state.error} />
      <button
        className={primaryButtonClassName}
        disabled={pending}
        type="submit"
      >
        <span className="login-stamp-label">
          {pending ? "Activando…" : "Activar y entrar"}
        </span>
      </button>
      <p className="text-center text-[13.5px] text-[color:var(--login-ink-muted)]">
        <Link
          className="font-medium text-[color:var(--login-ink)] hover:underline"
          href="/mi/entrar"
        >
          Ya tengo cuenta
        </Link>
      </p>
    </form>
  );
};
