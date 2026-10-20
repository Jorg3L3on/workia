import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn();
const push = vi.fn();

vi.mock("next-auth/react", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({
    push,
  }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => null,
}));

import { AdminShell as BaseAdminShell } from "@/components/layout/admin-shell";
import { TooltipProvider } from "@/components/ui/tooltip";

const AdminShell = ({ children }: { children: React.ReactNode }) => (
  <TooltipProvider>
    <BaseAdminShell
      user={{ name: "System Admin", email: "admin@workia.local" }}
    >
      {children}
    </BaseAdminShell>
  </TooltipProvider>
);
import { chromeCopy } from "@/lib/brand/chrome-copy";

afterEach(() => {
  cleanup();
  signOut.mockReset();
  push.mockReset();
});

describe("AdminShell", () => {
  it("calls Auth.js signOut then navigates to /login", async () => {
    signOut.mockResolvedValue(undefined);

    render(
      <AdminShell>
        <p>Admin</p>
      </AdminShell>,
    );

    const userMenu = screen.getByLabelText("Menú de usuario");
    fireEvent.pointerDown(userMenu, { button: 0, ctrlKey: false });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Cerrar sesión" }),
    );

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledWith({ redirect: false });
    });
    expect(push).toHaveBeenCalledWith("/login");
    expect(document.querySelector("form")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: chromeCopy.sidebarToggle }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Toggle Sidebar")).toBeNull();
  });

  it("keeps the chrome header sticky at the top", () => {
    render(
      <AdminShell>
        <p>Admin</p>
      </AdminShell>,
    );

    const headers = document.querySelectorAll('[data-slot="shell-top-nav"]');
    expect(headers).toHaveLength(1);
    expect(headers[0]?.className).toContain("sticky");
    expect(headers[0]?.className).toContain("top-0");
    expect(
      document.querySelector('[data-slot="sidebar-inset"]')?.className,
    ).not.toContain("sticky");
  });

  it("pins the sidebar to the viewport and scrolls only the content column", () => {
    render(
      <AdminShell>
        <p>Admin</p>
      </AdminShell>,
    );

    const wrapper = document.querySelector('[data-slot="sidebar-wrapper"]');
    expect(wrapper?.className).toContain("h-dvh");
    expect(wrapper?.className).toContain("overflow-hidden");
    expect(wrapper?.parentElement?.className).toContain("h-dvh");
    expect(wrapper?.parentElement?.className).toContain("overflow-hidden");

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
  });

  it("scrolls the whole inset and centers the content in an inner column", () => {
    render(
      <AdminShell>
        <p>Admin</p>
      </AdminShell>,
    );

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
    expect(column?.className).toContain("flex-col");
    expect(column?.className).toContain("gap-4");
    expect(column?.textContent).toContain("Admin");
  });

  it("shows Spanish breadcrumbs in the sticky header", () => {
    render(
      <AdminShell>
        <p>Admin</p>
      </AdminShell>,
    );

    const breadcrumb = screen.getByRole("navigation", { name: "Miga de pan" });
    expect(breadcrumb.textContent).toContain("Administración");
    expect(
      document
        .querySelector('[data-slot="shell-top-nav"]')
        ?.querySelector('[data-slot="breadcrumb"]'),
    ).toBeTruthy();
  });

  it("shows the /app brand with an Administración badge and Spanish nav", () => {
    render(
      <AdminShell>
        <p>Admin</p>
      </AdminShell>,
    );

    const brand = screen.getByRole("link", { name: /workia/ });
    expect(brand.textContent).toContain("Administración");
    expect(screen.getByRole("link", { name: "Resumen" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Volver a la app" })).toBeTruthy();
    expect(screen.queryByText(/workia admin/i)).toBeNull();
  });

  it("starts the top loader when navigating to Roles y permisos", () => {
    render(
      <AdminShell>
        <p>Admin</p>
      </AdminShell>,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Roles y permisos" }));

    expect(
      screen.getByRole("progressbar", { name: chromeCopy.navigationProgress }),
    ).toBeTruthy();
    expect(document.querySelector('[data-slot="sidebar"]')).toBeTruthy();
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

describe("AdminShell sidebar wheel forwarding", () => {
  const slot = (name: string) =>
    document.querySelector(`[data-slot="${name}"]`);

  it("forwards the wheel over the sidebar to the shell scroller, in pixels", () => {
    render(
      <AdminShell>
        <p>Admin</p>
      </AdminShell>,
    );
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
    render(
      <AdminShell>
        <p>Admin</p>
      </AdminShell>,
    );
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
    render(
      <AdminShell>
        <p>Admin</p>
      </AdminShell>,
    );
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
