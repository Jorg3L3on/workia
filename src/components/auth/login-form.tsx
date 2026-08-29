"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { LoginBadgeStub } from "@/components/auth/login-badge-stub";
import { WorkiaMark } from "@/components/brand/workia-mark";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";

const loginSchema = z.object({
  email: z.string().email("Ingresa un correo válido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const fieldLabelClassName =
  "mb-2 block font-mono text-[10.5px] font-medium tracking-[0.09em] text-[color:var(--login-ink-faint)] uppercase";

const fieldInputClassName = cn(
  "w-full border-0 border-b-[1.5px] border-[color:var(--login-line-strong)] bg-transparent px-0.5 py-2.5 text-[14.5px] text-[color:var(--login-ink)] shadow-none outline-none",
  "placeholder:text-[color:var(--login-ink-faint)]",
  "focus-visible:border-transparent focus-visible:ring-0",
);

export const LoginForm = () => {
  const [error, setError] = useState<string | null>(null);
  const [isStamped, setIsStamped] = useState(false);
  const stampTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    return () => {
      if (stampTimeoutRef.current) {
        clearTimeout(stampTimeoutRef.current);
      }
    };
  }, []);

  const handleLogin = async (values: LoginFormValues) => {
    setError(null);
    setIsStamped(false);

    const result = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (result?.error || result?.ok === false) {
      setError("Correo o contraseña incorrectos.");
      return;
    }

    const navigateToApp = () => {
      window.location.assign("/app");
    };

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (!reduceMotion) {
      setIsStamped(true);
      stampTimeoutRef.current = setTimeout(navigateToApp, 1100);
      return;
    }

    navigateToApp();
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    void handleSubmit(handleLogin)(event);
  };

  return (
    <div className="login-badge-shadow w-full">
      <div className="login-badge" data-testid="login-badge">
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
              ID · RRHH
            </span>
          </div>

          <h1 className="mb-1.5 text-[22px] font-semibold tracking-[-0.015em] text-[color:var(--login-ink)] sm:text-[25px]">
            Bienvenido a workia
          </h1>
          <p className="mb-[26px] text-[13.5px] leading-normal text-[color:var(--login-ink-muted)]">
            Entra con tu cuenta para continuar con tu gente.
          </p>

          <form className="space-y-5" onSubmit={handleFormSubmit} noValidate>
            <div>
              <label htmlFor="email" className={fieldLabelClassName}>
                Correo electrónico
              </label>
              <div className="login-input-line">
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="nombre@empresa.com"
                  aria-invalid={Boolean(errors.email)}
                  className={fieldInputClassName}
                  {...register("email")}
                />
              </div>
              {errors.email ? (
                <p className="mt-1.5 text-sm text-red-400" role="alert">
                  {errors.email.message}
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="password" className={fieldLabelClassName}>
                Contraseña
              </label>
              <div className="login-input-line">
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  className={cn(fieldInputClassName, "pr-9")}
                  {...register("password")}
                />
              </div>
              {errors.password ? (
                <p className="mt-1.5 text-sm text-red-400" role="alert">
                  {errors.password.message}
                </p>
              ) : null}
            </div>

            {error ? (
              <div className="text-sm text-red-400" role="alert">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting || isStamped}
              data-stamped={isStamped ? "true" : "false"}
              className="login-stamp-btn mt-1.5 min-h-11 w-full rounded-lg px-0 py-3.5 text-[15px] font-semibold tracking-[0.01em] transition-[transform,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-[color:var(--login-accent-violet)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--login-badge-a)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-80"
            >
              <span className="login-stamp-label transition-opacity duration-200">
                {isSubmitting && !isStamped
                  ? "Iniciando sesión..."
                  : "Iniciar sesión"}
              </span>
              <span className="login-stamp-mark" aria-hidden>
                ✓ &nbsp;ACCESO
              </span>
            </button>
          </form>
        </div>

        <LoginBadgeStub />
      </div>
    </div>
  );
};
