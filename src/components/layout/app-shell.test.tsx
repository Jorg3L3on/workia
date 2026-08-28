import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const { submitSignOutFormMock } = vi.hoisted(() => ({
  submitSignOutFormMock: vi.fn(),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/lib/auth/client-sign-out", () => ({
  submitSignOutForm: submitSignOutFormMock,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
}));

vi.mock("@/components/nav-user", () => ({
  NavUser: ({ onSignOut }: { onSignOut?: () => void | Promise<void> }) => (
    <button type="button" onClick={() => void onSignOut?.()}>
      Cerrar sesión
    </button>
  ),
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => null,
}));

import { AppShell } from "@/components/layout/app-shell";

describe("AppShell", () => {
  it("submits Auth.js signout via form POST helper when Cerrar sesión is selected", async () => {
    submitSignOutFormMock.mockResolvedValue(undefined);

    render(
      <TooltipProvider>
        <AppShell user={{ name: "Elena Demo", email: "rrhh@workia.local" }}>
          <p>Contenido</p>
        </AppShell>
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(submitSignOutFormMock).toHaveBeenCalledWith({ redirectTo: "/" });
  });
});
