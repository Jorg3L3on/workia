"use client";

export const SIGN_OUT_PATH = "/logout";
export const SIGN_OUT_FORM_ID = "workia-sign-out-form";
export const DEFAULT_SIGN_OUT_REDIRECT = "/login";

type SignOutFormProps = {
  redirectTo?: string;
  formId?: string;
};

export const SignOutForm = ({
  redirectTo = DEFAULT_SIGN_OUT_REDIRECT,
  formId = SIGN_OUT_FORM_ID,
}: SignOutFormProps) => (
  <form
    id={formId}
    method="POST"
    action={SIGN_OUT_PATH}
    className="hidden"
    aria-hidden
  >
    <input type="hidden" name="redirectTo" value={redirectTo} />
  </form>
);
