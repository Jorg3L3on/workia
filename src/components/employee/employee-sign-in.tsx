"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  passwordSignInAction,
  requestLoginCodeAction,
  verifyLoginCodeAction,
  type EmployeeSignInState,
} from "@/lib/employee/actions";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";

import {
  FieldError,
  fieldInputClassName,
  fieldLabelClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "./employee-badge";

type Mode = "correo" | "curp";

type EmployeeSignInProps = {
  defaultEmail?: string;
  defaultCode?: string;
  googleEnabled: boolean;
  error?: string | null;
};

const SubmitLabel = ({
  pending,
  idle,
  busy,
}: {
  pending: boolean;
  idle: string;
  busy: string;
}) => <span className="login-stamp-label">{pending ? busy : idle}</span>;

/**
 * /mi/entrar (W2-01): a code by email (the default), Google, or CURP and
 * password for people who activated with an HR code.
 */
export const EmployeeSignIn = ({
  defaultEmail = "",
  defaultCode = "",
  googleEnabled,
  error,
}: EmployeeSignInProps) => {
  const [mode, setMode] = useState<Mode>("correo");
  const [requestState, requestAction, requesting] = useActionState<
    EmployeeSignInState,
    FormData
  >(requestLoginCodeAction, {
    email: defaultEmail,
    codeSent: Boolean(defaultEmail && defaultCode),
  });
  const [verifyState, verifyAction, verifying] = useActionState<
    EmployeeSignInState,
    FormData
  >(verifyLoginCodeAction, {});
  const [passwordState, passwordAction, signingIn] = useActionState<
    EmployeeSignInState,
    FormData
  >(passwordSignInAction, {});
  // «Use another email» hides the code step until the next code request.
  const [dismissed, setDismissed] = useState<EmployeeSignInState | null>(null);

  const codeStep = Boolean(requestState.codeSent) && dismissed !== requestState;
  const email = requestState.email ?? defaultEmail;

  return (
    <div className="space-y-5">
      <div
        aria-label="Cómo entrar"
        className="grid grid-cols-2 gap-1 rounded-lg border border-[color:var(--login-line)] p-1 text-sm"
        role="tablist"
      >
        {(
          [
            ["correo", "Con mi correo"],
            ["curp", "Con mi CURP"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={mode === value}
            className={cn(
              "min-h-10 rounded-md font-medium text-[color:var(--login-ink-muted)]",
              mode === value &&
                "bg-[color:var(--login-line)] text-[color:var(--login-ink)]",
            )}
            key={value}
            onClick={() => setMode(value)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <FieldError message={error} />

      {mode === "correo" && !codeStep ? (
        <form action={requestAction} className="space-y-5" noValidate>
          <div>
            <label className={fieldLabelClassName} htmlFor="employee-email">
              Correo electrónico
            </label>
            <div className="login-input-line">
              <input
                autoComplete="email"
                className={fieldInputClassName}
                defaultValue={email}
                id="employee-email"
                inputMode="email"
                name="email"
                placeholder="tu@correo.com"
                required
                type="email"
              />
            </div>
          </div>
          <FieldError message={requestState.error} />
          <button
            className={primaryButtonClassName}
            disabled={requesting}
            type="submit"
          >
            <SubmitLabel
              busy="Enviando…"
              idle="Enviarme un código"
              pending={requesting}
            />
          </button>
        </form>
      ) : null}

      {mode === "correo" && codeStep ? (
        <form action={verifyAction} className="space-y-5" noValidate>
          <p
            className="text-[13.5px] text-[color:var(--login-ink-muted)]"
            role="status"
          >
            Si{" "}
            <span className="font-medium text-[color:var(--login-ink)]">
              {email}
            </span>{" "}
            tiene una cuenta, te enviamos un código de 6 dígitos. Vence en 10
            minutos.
          </p>
          <input name="email" type="hidden" value={email} />
          <div>
            <label className={fieldLabelClassName} htmlFor="employee-code">
              Código
            </label>
            <div className="login-input-line">
              <input
                autoComplete="one-time-code"
                className={cn(fieldInputClassName, "tracking-[0.3em]")}
                defaultValue={defaultCode}
                id="employee-code"
                inputMode="numeric"
                maxLength={7}
                name="code"
                placeholder="000000"
                required
              />
            </div>
          </div>
          <FieldError message={verifyState.error} />
          <button
            className={primaryButtonClassName}
            disabled={verifying}
            type="submit"
          >
            <SubmitLabel busy="Entrando…" idle="Entrar" pending={verifying} />
          </button>
          <button
            className="w-full text-sm font-medium text-[color:var(--login-ink-muted)] hover:underline"
            onClick={() => setDismissed(requestState)}
            type="button"
          >
            Usar otro correo o pedir otro código
          </button>
        </form>
      ) : null}

      {mode === "curp" ? (
        <form action={passwordAction} className="space-y-5" noValidate>
          <div>
            <label className={fieldLabelClassName} htmlFor="employee-curp">
              CURP
            </label>
            <div className="login-input-line">
              <input
                autoCapitalize="characters"
                autoComplete="username"
                className={cn(fieldInputClassName, "uppercase")}
                id="employee-curp"
                maxLength={18}
                name="curp"
                required
              />
            </div>
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="employee-password">
              Contraseña
            </label>
            <div className="login-input-line">
              <PasswordInput
                autoComplete="current-password"
                className={cn(fieldInputClassName, "pr-9")}
                id="employee-password"
                name="password"
                required
              />
            </div>
          </div>
          <FieldError message={passwordState.error} />
          <button
            className={primaryButtonClassName}
            disabled={signingIn}
            type="submit"
          >
            <SubmitLabel busy="Entrando…" idle="Entrar" pending={signingIn} />
          </button>
        </form>
      ) : null}

      {googleEnabled ? (
        <a
          className={cn(
            secondaryButtonClassName,
            "flex items-center justify-center",
          )}
          href="/api/mi/google"
        >
          Entrar con Google
        </a>
      ) : null}

      <p className="text-center text-[13.5px] text-[color:var(--login-ink-muted)]">
        ¿RH te dio un código de activación?{" "}
        <Link
          className="font-medium text-[color:var(--login-ink)] hover:underline"
          href="/mi/activar"
        >
          Activa tu cuenta
        </Link>
      </p>
    </div>
  );
};
