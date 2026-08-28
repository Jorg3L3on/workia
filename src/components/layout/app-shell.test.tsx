import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
}));

vi.mock("@/components/nav-user", () => ({
  NavUser: () => (
    <button type="button" aria-label="Cerrar sesión">
      Cerrar sesión
    </button>
  ),
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => null,
}));

import { AppShell } from "@/components/layout/app-shell";

describe("AppShell", () => {
  it("renders the authenticated shell with Cerrar sesión", () => {
    render(
      <TooltipProvider>
        <AppShell user={{ name: "Elena Demo", email: "rrhh@workia.local" }}>
          <p>Contenido</p>
        </AppShell>
      </TooltipProvider>,
    );

    expect(screen.getByText("Contenido")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
  });
});
