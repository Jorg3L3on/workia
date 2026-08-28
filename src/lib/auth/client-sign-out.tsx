"use client";

export const SIGN_OUT_PATH = "/logout";
export const SIGN_OUT_FORM_ID = "workia-sign-out-form";
export const DEFAULT_SIGN_OUT_REDIRECT = "/login";

type SignOutFormProps = {
  redirectTo?: string;
  formId?: string;
};

/**
 * Native document POST. `HTMLFormElement.prototype.submit` does not fire
 * `submit`, so Next.js App Router cannot intercept it as fetch/RSC.
 * `requestSubmit()` does fire `submit` and is intercepted — Set-Cookie then
 * never reaches the document cookie jar.
 */
export const submitNativeSignOutForm = (form?: HTMLFormElement | null) => {
  const target =
    form instanceof HTMLFormElement
      ? form
      : document.getElementById(SIGN_OUT_FORM_ID);

  if (!(target instanceof HTMLFormElement)) {
    return;
  }

  HTMLFormElement.prototype.submit.call(target);
};

export const handleNativeSignOutSelect = (event: Event) => {
  event.preventDefault();
  submitNativeSignOutForm();
};

export const SignOutForm = ({
  redirectTo = DEFAULT_SIGN_OUT_REDIRECT,
  formId = SIGN_OUT_FORM_ID,
}: SignOutFormProps) => (
  <form
    id={formId}
    method="POST"
    action={SIGN_OUT_PATH}
    target="_self"
    className="hidden"
    aria-hidden
  >
    <input type="hidden" name="redirectTo" value={redirectTo} />
  </form>
);
