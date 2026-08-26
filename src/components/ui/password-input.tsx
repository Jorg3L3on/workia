"use client";

import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState } from "react";

import { cn } from "@/lib/utils";

type PasswordInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
};

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [showPassword, setShowPassword] = useState(false);

    const handleTogglePassword = () => {
      setShowPassword((prev) => !prev);
    };

    const handleToggleKeyDown = (
      event: React.KeyboardEvent<HTMLButtonElement>,
    ) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      handleTogglePassword();
    };

    return (
      <div className="relative">
        <input
          ref={ref}
          type={showPassword ? "text" : "password"}
          className={cn("pr-11", className)}
          {...props}
        />
        <button
          type="button"
          tabIndex={0}
          aria-label={
            showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
          }
          onClick={handleTogglePassword}
          onKeyDown={handleToggleKeyDown}
          className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-[#8b899a] transition-colors hover:text-[#f4f3f8] focus-visible:ring-2 focus-visible:ring-[rgba(124,110,255,0.55)] focus-visible:outline-none"
        >
          {showPassword ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      </div>
    );
  },
);

PasswordInput.displayName = "PasswordInput";
