import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import {
  DEFAULT_SIGN_OUT_REDIRECT,
  SIGN_OUT_FORM_ID,
  SIGN_OUT_PATH,
  SignOutForm,
} from "@/lib/auth/client-sign-out";

describe("SignOutForm", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a mounted POST form targeting the logout route", () => {
    render(<SignOutForm redirectTo="/login" />);

    const form = document.getElementById(SIGN_OUT_FORM_ID);
    expect(form).toBeInstanceOf(HTMLFormElement);
    expect((form as HTMLFormElement).method.toLowerCase()).toBe("post");
    expect((form as HTMLFormElement).action).toContain(SIGN_OUT_PATH);

    const redirectInput = form?.querySelector<HTMLInputElement>(
      'input[name="redirectTo"]',
    );

    expect(redirectInput?.value).toBe("/login");
    expect(form?.querySelector('input[name="csrfToken"]')).toBeNull();
  });

  it("defaults redirectTo to /login", () => {
    render(<SignOutForm />);

    const redirectInput = document.querySelector<HTMLInputElement>(
      'input[name="redirectTo"]',
    );
    expect(redirectInput?.value).toBe(DEFAULT_SIGN_OUT_REDIRECT);
  });
});
