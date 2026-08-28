import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SIGN_OUT_REDIRECT,
  SIGN_OUT_PATH,
  submitSignOutForm,
} from "@/lib/auth/client-sign-out";

describe("submitSignOutForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("POSTs to the Workia sign-out route via a native form submit", () => {
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, "submit");

    submitSignOutForm({ redirectTo: "/" });

    const form = document.querySelector(`form[action="${SIGN_OUT_PATH}"]`);
    expect(form).toBeTruthy();
    expect(form).toBeInstanceOf(HTMLFormElement);
    expect((form as HTMLFormElement).method.toLowerCase()).toBe("post");

    const redirectInput = form?.querySelector<HTMLInputElement>(
      'input[name="redirectTo"]',
    );

    expect(redirectInput?.value).toBe("/");
    expect(form?.querySelector('input[name="csrfToken"]')).toBeNull();
    expect(submitSpy).toHaveBeenCalledOnce();
  });

  it("uses the landing page when redirectTo is omitted", () => {
    vi.spyOn(HTMLFormElement.prototype, "submit");

    submitSignOutForm();

    const redirectInput = document.querySelector<HTMLInputElement>(
      'input[name="redirectTo"]',
    );
    expect(redirectInput?.value).toBe(DEFAULT_SIGN_OUT_REDIRECT);
  });
});
