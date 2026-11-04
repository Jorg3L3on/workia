import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { env } from "@/env";

import {
  resolveEmployeeSession,
  type EmployeeContext,
  type NewEmployeeSession,
} from "./sign-in";

/**
 * The employee session cookie (W2-01): separate from Auth.js, so an HR user
 * who is also an employee has two independent sessions. On HTTPS the
 * __Host- prefix pins it to this host and path /.
 */
export const EMPLOYEE_SESSION_COOKIE_NAMES = [
  "workia.employee-session",
  "__Host-workia.employee-session",
] as const;

const secureCookies = () => env.NODE_ENV === "production";

export const employeeSessionCookieName = () =>
  secureCookies()
    ? EMPLOYEE_SESSION_COOKIE_NAMES[1]
    : EMPLOYEE_SESSION_COOKIE_NAMES[0];

/** Where /mi sends someone without a session. */
export const EMPLOYEE_SIGN_IN_PATH = "/mi/entrar";

export const setEmployeeSessionCookie = async (session: NewEmployeeSession) => {
  (await cookies()).set(employeeSessionCookieName(), session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    expires: session.expiresAt,
  });
};

export const readEmployeeSessionToken = async () =>
  (await cookies()).get(employeeSessionCookieName())?.value ?? null;

export const clearEmployeeSessionCookie = async () => {
  (await cookies()).delete(employeeSessionCookieName());
};

/** The signed-in employee of this request, or null. One lookup per request. */
export const getEmployeeContext = cache(
  async (): Promise<EmployeeContext | null> => {
    const token = await readEmployeeSessionToken();

    return token ? resolveEmployeeSession(token) : null;
  },
);

/**
 * The only door to an employee's data: `{ accountId, companyId, personId }`
 * from the session, never from the URL or a form. /mi routes read every
 * record with this personId; anything else is a 404.
 */
export const requireEmployeeContext = async (): Promise<EmployeeContext> => {
  const context = await getEmployeeContext();

  if (!context) {
    redirect(EMPLOYEE_SIGN_IN_PATH);
  }

  return context;
};

/** The caller's IP for per-IP limits (Vercel sets x-forwarded-for). */
export const requestIp = async () => {
  const list = await headers();

  return (
    list.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    list.get("x-real-ip") ||
    "unknown"
  );
};

/** Public origin for links in emails: APP_PUBLIC_URL, else this request's host. */
export const requestOrigin = async () => {
  if (env.APP_PUBLIC_URL) {
    return new URL(env.APP_PUBLIC_URL).origin;
  }

  const list = await headers();
  const host =
    list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto =
    list.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${proto}://${host}`;
};
