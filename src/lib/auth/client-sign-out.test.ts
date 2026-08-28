import { afterEach, describe, expect, it, vi } from "vitest";

const { getCsrfTokenMock } = vi.hoisted(() => ({
  getCsrfTokenMock: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  getCsrfToken: getCsrfTokenMock,
}));

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

  it("POSTs to Auth.js signout with csrf and callbackUrl via a real form submit", async () => {
    getCsrfTokenMock.mockResolvedValue("csrf-test-token");
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, "submit");

    await submitSignOutForm({ redirectTo: "/" });

    const form = document.querySelector(`form[action="${SIGN_OUT_PATH}"]`);
    expect(form).toBeTruthy();
    expect(form).toBeInstanceOf(HTMLFormElement);
    expect((form as HTMLFormElement).method.toLowerCase()).toBe("post");

    const csrfInput = form?.querySelector<HTMLInputElement>(
      'input[name="csrfToken"]',
    );
    const callbackInput = form?.querySelector<HTMLInputElement>(
      'input[name="callbackUrl"]',
    );

    expect(csrfInput?.value).toBe("csrf-test-token");
    expect(callbackInput?.value).toBe("/");
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(getCsrfTokenMock).toHaveBeenCalledOnce();
  });

  it("uses the landing page when redirectTo is omitted", async () => {
    getCsrfTokenMock.mockResolvedValue("csrf-test-token");
    vi.spyOn(HTMLFormElement.prototype, "submit");

    await submitSignOutForm();

    const callbackInput = document.querySelector<HTMLInputElement>(
      'input[name="callbackUrl"]',
    );
    expect(callbackInput?.value).toBe(DEFAULT_SIGN_OUT_REDIRECT);
  });

  it("throws when csrf token is unavailable", async () => {
    getCsrfTokenMock.mockResolvedValue(null);

    await expect(submitSignOutForm()).rejects.toThrow(
      "No se pudo cerrar la sesión. Intenta de nuevo.",
    );
  });
});
