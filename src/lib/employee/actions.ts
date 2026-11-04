"use server";

import { redirect } from "next/navigation";

import {
  readEmployeeSessionToken,
  clearEmployeeSessionCookie,
  EMPLOYEE_SIGN_IN_PATH,
  requestIp,
  requestOrigin,
  setEmployeeSessionCookie,
} from "@/lib/employee-accounts/session";
import {
  activateWithCode,
  endEmployeeSession,
  requestLoginCode,
  signInWithPassword,
  verifyLoginCode,
  type SignInResult,
} from "@/lib/employee-accounts/sign-in";

/**
 * Employee sign-in from /mi/entrar and /mi/activar (W2-01). No company
 * context here: the credential names the account. Success sets the employee
 * cookie and goes to /mi.
 */
export type EmployeeSignInState = {
  error?: string;
  /** Email sign-in: the code went out (or would have), ask for it now. */
  codeSent?: boolean;
  email?: string;
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
};

const finish = async (result: SignInResult): Promise<EmployeeSignInState> => {
  if (!result.ok) {
    return { error: result.error };
  }

  await setEmployeeSessionCookie(result.session);
  redirect("/mi");
};

export const requestLoginCodeAction = async (
  _state: EmployeeSignInState,
  formData: FormData,
): Promise<EmployeeSignInState> => {
  const email = text(formData, "email");
  const result = await requestLoginCode({
    email,
    ip: await requestIp(),
    origin: await requestOrigin(),
  });

  return result.ok ? { codeSent: true, email } : { error: result.error, email };
};

export const verifyLoginCodeAction = async (
  _state: EmployeeSignInState,
  formData: FormData,
): Promise<EmployeeSignInState> => {
  const email = text(formData, "email");
  const state = await finish(
    await verifyLoginCode({
      email,
      code: text(formData, "code"),
      ip: await requestIp(),
    }),
  );

  return { ...state, codeSent: true, email };
};

export const passwordSignInAction = async (
  _state: EmployeeSignInState,
  formData: FormData,
): Promise<EmployeeSignInState> =>
  finish(
    await signInWithPassword({
      curp: text(formData, "curp"),
      password: String(formData.get("password") ?? ""),
      ip: await requestIp(),
    }),
  );

export const activateAccountAction = async (
  _state: EmployeeSignInState,
  formData: FormData,
): Promise<EmployeeSignInState> => {
  const password = String(formData.get("password") ?? "");

  if (password !== String(formData.get("confirm") ?? "")) {
    return { error: "Las contraseñas no coinciden." };
  }

  return finish(
    await activateWithCode({
      curp: text(formData, "curp"),
      code: text(formData, "code"),
      password,
      ip: await requestIp(),
    }),
  );
};

export const signOutEmployeeAction = async () => {
  const token = await readEmployeeSessionToken();

  if (token) {
    await endEmployeeSession(token);
  }

  await clearEmployeeSessionCookie();
  redirect(EMPLOYEE_SIGN_IN_PATH);
};
