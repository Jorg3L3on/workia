import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  cleanup();
});

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

  it("keeps the chrome header sticky at the top", () => {
    render(
      <TooltipProvider>
        <AppShell user={{ name: "Elena Demo", email: "rrhh@workia.local" }}>
          <p>Contenido</p>
        </AppShell>
      </TooltipProvider>,
    );

    const headers = document.querySelectorAll('[data-slot="shell-top-nav"]');
    expect(headers).toHaveLength(1);
    expect(headers[0]?.className).toContain("sticky");
    expect(headers[0]?.className).toContain("top-0");
    expect(
      document.querySelector('[data-slot="sidebar-inset"]')?.className,
    ).not.toContain("sticky");
  });
});
