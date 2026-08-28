import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import {
  SIGN_OUT_FORM_ID,
  SIGN_OUT_PATH,
  SignOutForm,
} from "@/lib/auth/client-sign-out";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
}));

vi.mock("@/components/nav-user", () => ({
  NavUser: () => (
    <>
      <SignOutForm />
      <button type="submit" form={SIGN_OUT_FORM_ID}>
        Cerrar sesión
      </button>
    </>
  ),
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => null,
}));

import { AppShell } from "@/components/layout/app-shell";

describe("AppShell", () => {
  it("includes a native POST sign-out form when Cerrar sesión is used", () => {
    render(
      <TooltipProvider>
        <AppShell user={{ name: "Elena Demo", email: "rrhh@workia.local" }}>
          <p>Contenido</p>
        </AppShell>
      </TooltipProvider>,
    );

    const form = document.querySelector(`form[action*="${SIGN_OUT_PATH}"]`);
    expect(form).toBeInstanceOf(HTMLFormElement);
    expect((form as HTMLFormElement).method.toLowerCase()).toBe("post");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(form).toBeTruthy();
  });
});
