import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOGOUT_LATCH_COOKIE_NAME,
  applyLogoutLatchInDocument,
} from "@/lib/auth/logout-latch";

const signIn = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    refresh,
  }),
}));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => (
    <span role="img" aria-label={props.alt ?? ""} />
  ),
}));

import { LoginForm } from "@/components/auth/login-form";

describe("LoginForm", () => {
  beforeEach(() => {
    signIn.mockReset();
    push.mockReset();
    refresh.mockReset();
    document.cookie = `${LOGOUT_LATCH_COOKIE_NAME}=; Path=/; Max-Age=0`;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
  });

  afterEach(() => {
    cleanup();
    document.cookie = `${LOGOUT_LATCH_COOKIE_NAME}=; Path=/; Max-Age=0`;
  });

  it("clears the logout latch after a successful sign-in", async () => {
    signIn.mockResolvedValue({ error: undefined, ok: true });
    applyLogoutLatchInDocument();
    expect(document.cookie).toContain(`${LOGOUT_LATCH_COOKIE_NAME}=1`);

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "persona@empresa.local" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "password12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledOnce();
    });
    expect(document.cookie).not.toContain(`${LOGOUT_LATCH_COOKIE_NAME}=1`);
    expect(push).toHaveBeenCalledWith("/app");
  });

  it("keeps the logout latch when sign-in fails", async () => {
    signIn.mockResolvedValue({ error: "CredentialsSignin", ok: false });
    applyLogoutLatchInDocument();

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "persona@empresa.local" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "password12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => {
      expect(screen.getByText("Correo o contraseña incorrectos.")).toBeTruthy();
    });
    expect(document.cookie).toContain(`${LOGOUT_LATCH_COOKIE_NAME}=1`);
    expect(push).not.toHaveBeenCalled();
  });
});
