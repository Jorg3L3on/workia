import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const { navigationState, mobileState } = vi.hoisted(() => ({
  navigationState: { pathname: "/app" },
  mobileState: { isMobile: false },
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.isMobile,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ push: vi.fn() }),
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
import { chromeCopy } from "@/lib/brand/chrome-copy";

const renderShell = () =>
  render(
    <TooltipProvider>
      <AppShell user={{ name: "Elena Demo", email: "rrhh@workia.local" }}>
        <p>Contenido</p>
      </AppShell>
    </TooltipProvider>,
  );

afterEach(() => {
  navigationState.pathname = "/app";
  mobileState.isMobile = false;
  cleanup();
});

describe("AppShell", () => {
  it("renders the authenticated shell with Cerrar sesión", () => {
    renderShell();

    expect(screen.getByText("Contenido")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: chromeCopy.sidebarToggle }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Toggle Sidebar")).toBeNull();
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelector(".workia-credential-slot")).toBeNull();
    expect(screen.getByRole("link", { name: /workia/i })).toBeTruthy();
  });

  it("keeps the chrome header sticky at the top", () => {
    renderShell();

    const headers = document.querySelectorAll('[data-slot="shell-top-nav"]');
    expect(headers).toHaveLength(1);
    expect(headers[0]?.className).toContain("sticky");
    expect(headers[0]?.className).toContain("top-0");
    expect(
      document.querySelector('[data-slot="sidebar-inset"]')?.className,
    ).not.toContain("sticky");
  });

  it("pins the sidebar to the viewport and scrolls only the content column", () => {
    renderShell();

    const shell = document.querySelector(".workia-shell");
    expect(shell?.className).toContain("h-dvh");
    expect(shell?.className).toContain("overflow-hidden");

    const wrapper = document.querySelector('[data-slot="sidebar-wrapper"]');
    expect(wrapper?.className).toContain("h-dvh");
    expect(wrapper?.className).toContain("overflow-hidden");

    const inset = document.querySelector('[data-slot="sidebar-inset"]');
    expect(inset?.className).toContain("min-h-0");
    expect(inset?.className).toContain("overflow-hidden");
    expect(inset?.className).not.toContain("overflow-y-auto");

    const mainScroll = document.querySelector(
      '[data-slot="shell-main-scroll"]',
    );
    expect(mainScroll?.className).toContain("min-h-0");
    expect(mainScroll?.className).toContain("overflow-y-auto");

    expect(document.querySelector('[data-slot="sidebar-header"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="sidebar-footer"]')).toBeTruthy();
    expect(
      document.querySelector('[data-slot="sidebar-content"]'),
    ).toBeTruthy();
  });

  it("shows a Spanish breadcrumb for Inicio in the sticky header", () => {
    renderShell();

    const breadcrumb = screen.getByRole("navigation", { name: "Miga de pan" });
    expect(breadcrumb).toBeTruthy();
    expect(breadcrumb.textContent).toContain("Inicio");
    expect(headersContainBreadcrumb()).toBe(true);
  });

  it("opens Catálogo with four children and marks the child active", () => {
    navigationState.pathname = "/app/catalogo/areas";
    renderShell();

    const sidebar = document.querySelector('[data-slot="sidebar"]');
    expect(sidebar).toBeTruthy();
    const sidebarQueries = within(sidebar as HTMLElement);

    const areasLink = sidebarQueries.getByRole("link", { name: "Áreas" });
    expect(areasLink.getAttribute("data-active")).toBe("true");
    expect(sidebarQueries.getByRole("link", { name: "Puestos" })).toBeTruthy();
    expect(
      sidebarQueries.getByRole("link", { name: "Actividades" }),
    ).toBeTruthy();
    expect(
      sidebarQueries.getByRole("link", { name: "Sucursales" }),
    ).toBeTruthy();

    const catalogButtons = sidebarQueries.getAllByRole("button", {
      name: "Catálogo",
    });
    expect(
      catalogButtons.some(
        (button) => button.getAttribute("data-active") === "true",
      ),
    ).toBe(false);

    const breadcrumb = screen.getByRole("navigation", { name: "Miga de pan" });
    expect(breadcrumb.textContent).toContain("Catálogo");
    expect(breadcrumb.textContent).toContain("Áreas");
    expect(
      within(breadcrumb)
        .getByRole("link", { name: "Catálogo" })
        .getAttribute("href"),
    ).toBe("/app/catalogo");
  });

  it("nests Personas over the current expediente name", () => {
    navigationState.pathname =
      "/app/personas/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    renderShell();

    const breadcrumb = screen.getByRole("navigation", { name: "Miga de pan" });
    expect(breadcrumb.textContent).toContain("Personas");
    expect(breadcrumb.textContent).toContain("Expediente");
    expect(
      within(breadcrumb)
        .getByRole("link", { name: "Personas" })
        .getAttribute("href"),
    ).toBe("/app/personas");
  });

  it("starts the top loader on Inicio → Personas and keeps the desktop sidebar", () => {
    renderShell();

    const sidebar = document.querySelector('[data-slot="sidebar"]');
    expect(sidebar).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Menú" })).toBeNull();

    fireEvent.click(
      within(sidebar as HTMLElement).getByRole("link", { name: "Personas" }),
    );

    expect(
      screen.getByRole("progressbar", { name: chromeCopy.navigationProgress }),
    ).toBeTruthy();
    expect(document.querySelector('[data-slot="sidebar"]')).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Menú" })).toBeNull();
  });

  it("closes the mobile menu as soon as a destination is chosen", () => {
    mobileState.isMobile = true;
    renderShell();

    fireEvent.click(
      screen.getByRole("button", { name: chromeCopy.sidebarToggle }),
    );

    const menu = screen.getByRole("dialog", { name: "Menú" });
    expect(menu).toBeTruthy();

    fireEvent.click(within(menu).getByRole("link", { name: "Personas" }));

    expect(screen.queryByRole("dialog", { name: "Menú" })).toBeNull();
    expect(
      screen.getByRole("progressbar", { name: chromeCopy.navigationProgress }),
    ).toBeTruthy();
  });
});

const headersContainBreadcrumb = () => {
  const header = document.querySelector('[data-slot="shell-top-nav"]');
  return Boolean(header?.querySelector('[data-slot="breadcrumb"]'));
};
