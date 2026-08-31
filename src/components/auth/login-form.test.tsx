import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signIn = vi.fn();
const assign = vi.fn();

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
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
    assign.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, assign },
    });
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion: reduce"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("hard-navigates to /app after a successful sign-in", async () => {
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
    expect(assign).toHaveBeenCalledWith("/app");
  });

  it("does not render the authenticated sticky chrome header", () => {
    render(<LoginForm />);

    expect(document.querySelector('[data-slot="shell-top-nav"]')).toBeNull();
    expect(document.querySelector("header.sticky")).toBeNull();
  });

  it("keeps the wordmark without the decorative slot under the logo", () => {
    render(<LoginForm />);

    expect(screen.getByText("workia")).toBeTruthy();
    expect(document.querySelector(".login-badge-slot")).toBeNull();
    expect(document.querySelector(".workia-credential-slot")).toBeNull();
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
    expect(assign).not.toHaveBeenCalled();
  });
});
