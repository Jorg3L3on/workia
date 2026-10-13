"use client";

import { signOut } from "next-auth/react";

import { companyCopy } from "@/lib/brand/chrome-copy";

export const SignOutButton = () => (
  <button
    type="button"
    onClick={() => void signOut({ callbackUrl: "/login" })}
    className="login-stamp-btn mt-1.5 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-0 py-3.5 text-[15px] font-semibold tracking-[0.01em] focus-visible:ring-2 focus-visible:ring-[color:var(--login-accent-violet)] focus-visible:outline-none"
  >
    {companyCopy.signOut}
  </button>
);
