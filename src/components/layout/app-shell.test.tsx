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

vi.mock("@/lib/people/actions", () => ({
  searchPeopleForPaletteAction: vi.fn(async () => []),
}));

vi.mock("@/lib/tenant/actions", () => ({
  switchCompanyAction: vi.fn(),
}));

import { AppShell } from "@/components/layout/app-shell";
import { chromeCopy } from "@/lib/brand/chrome-copy";

const companyA = { id: "a", name: "Ferretera Mandiola", roleName: "Admin" };
const companyB = { id: "b", name: "Comercial del Norte", roleName: "Viewer" };

const renderShell = (
  access: {
    canReadMembers?: boolean;
    canUseConnections?: boolean;
    canReadReports?: boolean;
    canReadDocuments?: boolean;
    isPlatformAdmin?: boolean;
  } = {},
) =>
  render(
    <TooltipProvider>
      <AppShell
        user={{ name: "Elena Demo", email: "rrhh@workia.local" }}
        company={companyA}
        companies={[companyA, companyB]}
        {...access}
      >
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
  it("shows the company but no switcher to someone with a single company", () => {
    render(
      <TooltipProvider>
        <AppShell
          user={{ name: "Elena Demo", email: "rrhh@workia.local" }}
          company={companyA}
          companies={[companyA]}
        >
          <p>Contenido</p>
        </AppShell>
      </TooltipProvider>,
    );

    expect(screen.getAllByTestId("active-company")[0].textContent).toBe(
      "Ferretera Mandiola",
    );
    expect(
      screen.queryByRole("button", { name: "Cambiar de empresa" }),
    ).toBeNull();
  });

  it("shows the active company in the sidebar and breadcrumbs, with a switcher", () => {
    navigationState.pathname = "/app/personas";
    renderShell();

    expect(screen.getByTestId("active-company").textContent).toBe(
      "Ferretera Mandiola",
    );
    expect(screen.getByTestId("breadcrumb-company").textContent).toBe(
      "Ferretera Mandiola",
    );
    expect(
      screen.getAllByRole("button", { name: "Cambiar de empresa" }).length,
    ).toBeGreaterThan(0);
  });

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

  it("scrolls the whole inset and centers the content in an inner column", () => {
    renderShell();

    const inset = document.querySelector('[data-slot="sidebar-inset"]');
    const mainScroll = inset?.querySelector('[data-slot="shell-main-scroll"]');
    expect(mainScroll?.parentElement).toBe(inset);
    expect(mainScroll?.className).toContain("w-full");
    expect(mainScroll?.className).toContain("p-4");
    expect(mainScroll?.className).not.toContain("max-w-6xl");
    expect(mainScroll?.className).not.toContain("mx-auto");

    const column = mainScroll?.querySelector(
      '[data-slot="shell-content-column"]',
    );
    expect(column?.parentElement).toBe(mainScroll);
    expect(column?.className).toContain("max-w-6xl");
    expect(column?.className).toContain("mx-auto");
    expect(column?.className).toContain("w-full");
    expect(column?.className).toContain("gap-4");
    expect(column?.textContent).toContain("Contenido");
  });

  it("shows a Spanish breadcrumb for Inicio in the sticky header", () => {
    renderShell();

    const breadcrumb = screen.getByRole("navigation", { name: "Miga de pan" });
    expect(breadcrumb).toBeTruthy();
    expect(breadcrumb.textContent).toContain("Inicio");
    expect(headersContainBreadcrumb()).toBe(true);
  });

  it("groups the sidebar into Operación, Reportes, Catálogo and Empresa", () => {
    renderShell({
      canReadMembers: true,
      canUseConnections: true,
      canReadReports: true,
      canReadDocuments: true,
    });

    const sidebar = within(
      document.querySelector('[data-slot="sidebar"]') as HTMLElement,
    );
    const linksIn = (group: string) =>
      within(sidebar.getByRole("list", { name: group }))
        .getAllByRole("link")
        .map((link) => link.textContent);

    expect(linksIn("Operación")).toEqual([
      "Inicio",
      "Personas",
      "Contratos",
      "Documentos",
      "Altas",
      "Resguardo",
    ]);
    expect(linksIn("Reportes")).toEqual(["Rotación"]);
    expect(linksIn("Empresa")).toEqual(["Miembros", "Conexiones", "Auditoría"]);
    expect(sidebar.getByRole("button", { name: "Catálogo" })).toBeTruthy();
    expect(sidebar.queryByText("Expediente")).toBeNull();
    expect(sidebar.queryByText("Inventario")).toBeNull();
  });

  it("hides Miembros and Conexiones without access", () => {
    renderShell();

    const sidebar = within(
      document.querySelector('[data-slot="sidebar"]') as HTMLElement,
    );
    expect(sidebar.queryByRole("link", { name: "Miembros" })).toBeNull();
    expect(sidebar.queryByRole("link", { name: "Conexiones" })).toBeNull();
    expect(sidebar.queryByRole("link", { name: "Rotación" })).toBeNull();
    expect(sidebar.queryByRole("link", { name: "Documentos" })).toBeNull();
    expect(sidebar.getByRole("link", { name: "Auditoría" })).toBeTruthy();
  });

  it("shows Plataforma only to platform admins, in the footer", () => {
    renderShell();
    expect(screen.queryByRole("link", { name: "Plataforma" })).toBeNull();
    cleanup();

    renderShell({ isPlatformAdmin: true });
    const footer = document.querySelector(
      '[data-slot="sidebar-footer"]',
    ) as HTMLElement;
    expect(
      within(footer)
        .getByRole("link", { name: "Plataforma" })
        .getAttribute("href"),
    ).toBe("/admin");
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

const makeScrollable = (
  element: Element | null,
  size: { scrollHeight: number; clientHeight: number },
) => {
  if (!element) {
    throw new Error("missing scroll element");
  }
  let top = 0;
  const maxTop = size.scrollHeight - size.clientHeight;
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: size.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: size.clientHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, maxTop));
    },
  });
  return element as HTMLElement;
};

const withViewportWidth = (width: number, run: () => void) => {
  const original = window.innerWidth;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  try {
    run();
  } finally {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: original,
    });
  }
};

describe("AppShell sidebar wheel forwarding", () => {
  const slot = (name: string) =>
    document.querySelector(`[data-slot="${name}"]`);

  it("forwards the wheel over the sidebar to the shell scroller, in pixels", () => {
    renderShell();
    const mainScroll = makeScrollable(slot("shell-main-scroll"), {
      scrollHeight: 3000,
      clientHeight: 800,
    });
    makeScrollable(slot("sidebar-content"), {
      scrollHeight: 400,
      clientHeight: 400,
    });

    fireEvent.wheel(slot("sidebar-container") as Element, { deltaY: 120 });
    expect(mainScroll.scrollTop).toBe(120);

    fireEvent.wheel(slot("sidebar-header") as Element, {
      deltaY: 3,
      deltaMode: WheelEvent.DOM_DELTA_LINE,
    });
    expect(mainScroll.scrollTop).toBe(120 + 3 * 16);

    fireEvent.wheel(slot("sidebar-footer") as Element, {
      deltaY: 1,
      deltaMode: WheelEvent.DOM_DELTA_PAGE,
    });
    expect(mainScroll.scrollTop).toBe(120 + 48 + 800);

    fireEvent.wheel(slot("sidebar-content") as Element, { deltaY: -968 });
    expect(mainScroll.scrollTop).toBe(0);
  });

  it("lets a scrollable sidebar-content consume the wheel before the content", () => {
    renderShell();
    const mainScroll = makeScrollable(slot("shell-main-scroll"), {
      scrollHeight: 3000,
      clientHeight: 800,
    });
    const content = makeScrollable(slot("sidebar-content"), {
      scrollHeight: 1000,
      clientHeight: 400,
    });

    fireEvent.wheel(content, { deltaY: 100 });
    expect(mainScroll.scrollTop).toBe(0);

    content.scrollTop = 600;
    fireEvent.wheel(content, { deltaY: 100 });
    expect(mainScroll.scrollTop).toBe(100);

    fireEvent.wheel(content, { deltaY: -100 });
    expect(mainScroll.scrollTop).toBe(100);

    content.scrollTop = 0;
    fireEvent.wheel(content, { deltaY: -100 });
    expect(mainScroll.scrollTop).toBe(0);
  });

  it("leaves the wheel alone below 768px and over the content column", () => {
    renderShell();
    const mainScroll = makeScrollable(slot("shell-main-scroll"), {
      scrollHeight: 3000,
      clientHeight: 800,
    });

    withViewportWidth(500, () => {
      fireEvent.wheel(slot("sidebar-container") as Element, { deltaY: 120 });
    });
    expect(mainScroll.scrollTop).toBe(0);

    fireEvent.wheel(slot("shell-content-column") as Element, { deltaY: 120 });
    expect(mainScroll.scrollTop).toBe(0);
  });
});

const headersContainBreadcrumb = () => {
  const header = document.querySelector('[data-slot="shell-top-nav"]');
  return Boolean(header?.querySelector('[data-slot="breadcrumb"]'));
};
