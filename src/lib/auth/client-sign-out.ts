"use client";

import { getCsrfToken } from "next-auth/react";

export const SIGN_OUT_PATH = "/api/auth/signout";
export const DEFAULT_SIGN_OUT_REDIRECT = "/";

type SubmitSignOutFormOptions = {
  redirectTo?: string;
};

/**
 * Ends the session with a native form POST to Auth.js signout (same as the
 * built-in confirmation page). Unlike next-auth/react signOut(), this does not
 * use fetch + X-Auth-Return-Redirect, so the browser applies Set-Cookie and
 * follows the redirect reliably in production.
 */
export const submitSignOutForm = async ({
  redirectTo = DEFAULT_SIGN_OUT_REDIRECT,
}: SubmitSignOutFormOptions = {}) => {
  const csrfToken = await getCsrfToken();

  if (!csrfToken) {
    throw new Error("No se pudo cerrar la sesión. Intenta de nuevo.");
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = SIGN_OUT_PATH;

  const csrfInput = document.createElement("input");
  csrfInput.type = "hidden";
  csrfInput.name = "csrfToken";
  csrfInput.value = csrfToken;
  form.appendChild(csrfInput);

  const callbackInput = document.createElement("input");
  callbackInput.type = "hidden";
  callbackInput.name = "callbackUrl";
  callbackInput.value = redirectTo;
  form.appendChild(callbackInput);

  document.body.appendChild(form);
  form.submit();
};
