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
});
