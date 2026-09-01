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

import { AdminShell } from "@/components/layout/admin-shell";
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

    fireEvent.click(screen.getByLabelText("Cerrar sesión"));

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
    expect(mainScroll?.className).toContain("flex-col");

    expect(document.querySelector('[data-slot="sidebar-header"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="sidebar-footer"]')).toBeTruthy();
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

  it("starts the top loader when navigating to RBAC", () => {
    render(
      <AdminShell>
        <p>Admin</p>
      </AdminShell>,
    );

    expect(screen.queryByRole("progressbar")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "RBAC" }));

    expect(
      screen.getByRole("progressbar", { name: chromeCopy.navigationProgress }),
    ).toBeTruthy();
    expect(document.querySelector('[data-slot="sidebar"]')).toBeTruthy();
  });
});
