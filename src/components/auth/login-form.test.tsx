import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  });

  it("navigates to /app after a successful sign-in", async () => {
    signIn.mockResolvedValue({ error: undefined, ok: true });

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
    expect(push).toHaveBeenCalledWith("/app");
  });

  it("shows an error and stays on login when sign-in fails", async () => {
    signIn.mockResolvedValue({ error: "CredentialsSignin", ok: false });

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
    expect(push).not.toHaveBeenCalled();
  });
});
