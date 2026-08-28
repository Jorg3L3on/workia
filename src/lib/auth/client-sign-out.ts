"use client";

export const SIGN_OUT_PATH = "/api/auth/sign-out";
export const DEFAULT_SIGN_OUT_REDIRECT = "/";

type SubmitSignOutFormOptions = {
  redirectTo?: string;
};

/**
 * Ends the session with a native same-origin form POST to our sign-out handler.
 * The server clears every Auth.js session cookie variant (including __Secure- on
 * HTTPS) before redirecting, avoiding Auth.js built-in signout Set-Cookie mismatches.
 */
export const submitSignOutForm = ({
  redirectTo = DEFAULT_SIGN_OUT_REDIRECT,
}: SubmitSignOutFormOptions = {}) => {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = SIGN_OUT_PATH;

  const redirectInput = document.createElement("input");
  redirectInput.type = "hidden";
  redirectInput.name = "redirectTo";
  redirectInput.value = redirectTo;
  form.appendChild(redirectInput);

  document.body.appendChild(form);
  form.submit();
};
