import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { LOGOUT_LATCH_COOKIE_NAME } from "@/lib/auth/logout-latch";
import {
  DEFAULT_SIGN_OUT_REDIRECT,
  SIGN_OUT_FORM_ID,
  SIGN_OUT_PATH,
  SignOutForm,
  handleNativeSignOutSelect,
  submitNativeSignOutForm,
} from "@/lib/auth/client-sign-out";

describe("SignOutForm", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.cookie = `${LOGOUT_LATCH_COOKIE_NAME}=; Path=/; Max-Age=0`;
    vi.restoreAllMocks();
  });

  it("renders a mounted POST form targeting the logout route", () => {
    render(<SignOutForm redirectTo="/login" />);

    const form = document.getElementById(SIGN_OUT_FORM_ID);
    expect(form).toBeInstanceOf(HTMLFormElement);
    expect((form as HTMLFormElement).method.toLowerCase()).toBe("post");
    expect((form as HTMLFormElement).action).toContain(SIGN_OUT_PATH);
    expect((form as HTMLFormElement).target).toBe("_self");

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

describe("submitNativeSignOutForm", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    document.cookie = `${LOGOUT_LATCH_COOKIE_NAME}=; Path=/; Max-Age=0`;
    vi.restoreAllMocks();
  });

  it("sets the logout latch on document.cookie before native submit", () => {
    let cookieWhenSubmitRan = "";
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {
        cookieWhenSubmitRan = document.cookie;
      });

    render(<SignOutForm />);
    submitNativeSignOutForm();

    expect(cookieWhenSubmitRan).toContain(`${LOGOUT_LATCH_COOKIE_NAME}=1`);
    expect(submitSpy).toHaveBeenCalledOnce();
  });

  it("uses HTMLFormElement.prototype.submit, not requestSubmit", () => {
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    const requestSubmitSpy = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});

    render(<SignOutForm />);

    const form = document.getElementById(SIGN_OUT_FORM_ID);
    expect(form).toBeInstanceOf(HTMLFormElement);

    submitNativeSignOutForm(form as HTMLFormElement);

    expect(submitSpy).toHaveBeenCalledOnce();
    expect(submitSpy.mock.instances[0]).toBe(form);
    expect(requestSubmitSpy).not.toHaveBeenCalled();
  });

  it("prevents default then native-submits on Radix select", () => {
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    const requestSubmitSpy = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});

    render(<SignOutForm />);

    const event = new Event("select");
    const preventDefault = vi.spyOn(event, "preventDefault");
    handleNativeSignOutSelect(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(requestSubmitSpy).not.toHaveBeenCalled();
  });
});
