"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

const fieldInputClassName = cn(
  "flex h-auto w-full rounded-xl border border-white/[0.09] bg-white/[0.04] px-3.5 py-3 text-sm text-[#f4f3f8] shadow-none outline-none",
  "placeholder:text-[#55535f]",
  "focus-visible:border-[rgba(124,110,255,0.55)] focus-visible:bg-white/[0.055] focus-visible:ring-4 focus-visible:ring-[rgba(124,110,255,0.12)]",
);

const fieldLabelClassName = "mb-2 block text-xs font-medium text-[#8b899a]";

export const LoginForm = () => {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
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

  const handleLogin = async (values: LoginFormValues) => {
    setError(null);

    const result = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password.");
      return;
    }

    router.push("/app");
    router.refresh();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-8">
        <p className="mb-1.5 text-xs text-[#8b899a]">Access your account</p>
        <h1 className="text-2xl font-semibold tracking-tight text-[#f4f3f8]">
          Sign in
        </h1>
      </div>

      <form
        className="flex flex-col"
        onSubmit={handleSubmit(handleLogin)}
        noValidate
      >
        <div className="mb-[18px]">
          <label htmlFor="email" className={fieldLabelClassName}>
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            aria-invalid={Boolean(errors.email)}
            className={fieldInputClassName}
            {...register("email")}
          />
          {errors.email ? (
            <p className="mt-1.5 text-sm text-red-400" role="alert">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="mb-[18px]">
          <label htmlFor="password" className={fieldLabelClassName}>
            Password
          </label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            className={fieldInputClassName}
            {...register("password")}
          />
          {errors.password ? (
            <p className="mt-1.5 text-sm text-red-400" role="alert">
              {errors.password.message}
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="mb-3 text-sm text-red-400" role="alert">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className={cn(
            "group relative mt-1.5 w-full overflow-hidden rounded-full border-0 bg-linear-to-r from-[#4FACFE] to-[#8B5CF6] px-4 py-3.5 text-sm font-semibold text-white",
            "shadow-[0_8px_24px_-8px_rgba(79,172,254,0.55)] transition-[transform,box-shadow,filter] duration-200",
            "hover:-translate-y-px hover:shadow-[0_12px_28px_-8px_rgba(139,92,246,0.65)] hover:brightness-110",
            "active:translate-y-0",
            "focus-visible:ring-2 focus-visible:ring-[#8B5CF6]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060914] focus-visible:outline-none",
            "disabled:pointer-events-none disabled:opacity-60",
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-[60%] w-2/5 skew-x-[-20deg] bg-linear-to-r from-transparent via-white/35 to-transparent transition-[left] duration-700 group-hover:left-[130%]"
          />
          <span className="relative">
            {isSubmitting ? "Signing in..." : "Sign in"}
          </span>
        </button>
      </form>

      <div className="my-[22px] flex items-center gap-2.5" aria-hidden>
        <div className="h-px flex-1 bg-white/[0.09]" />
      </div>

      <p className="text-center text-[13px] text-[#8b899a]">
        Need an account?{" "}
        <Link
          href="/register"
          className="font-medium text-[#f4f3f8] no-underline [border-bottom:1px_solid_rgba(255,255,255,0.25)] hover:[border-color:#f4f3f8]"
        >
          Create one
        </Link>
      </p>

      <div className="mt-auto flex justify-center gap-2 pt-6 text-[11px] text-[#55535f]">
        <Link
          href="/privacy"
          className="text-[#55535f] no-underline hover:text-[#8b899a]"
        >
          Privacy
        </Link>
        <span aria-hidden>·</span>
        <Link
          href="/terms"
          className="text-[#55535f] no-underline hover:text-[#8b899a]"
        >
          Terms
        </Link>
      </div>
    </div>
  );
};
