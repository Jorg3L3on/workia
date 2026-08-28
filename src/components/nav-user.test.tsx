import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIGN_OUT_FORM_ID, SIGN_OUT_PATH } from "@/lib/auth/client-sign-out";

afterEach(() => {
  cleanup();
});

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuButton: ({
    children,
    ...props
  }: React.ComponentProps<"button">) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  useSidebar: () => ({ isMobile: false }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <div>{children}</div>),
}));

import { NavUser } from "@/components/nav-user";

describe("NavUser", () => {
  it("shows Cerrar sesión and not billing or upgrade items", () => {
    render(
      <NavUser
        user={{
          name: "Elena Demo",
          email: "rrhh@workia.local",
          avatar: "",
          initials: "ED",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeTruthy();
    expect(screen.queryByText("Upgrade to Pro")).toBeNull();
    expect(screen.queryByText("Billing")).toBeNull();
    expect(screen.queryByText("Log out")).toBeNull();
    expect(screen.getAllByText("Elena Demo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("rrhh@workia.local").length).toBeGreaterThan(0);
  });

  it("uses a mounted native POST form for Cerrar sesión", () => {
    render(
      <NavUser
        user={{
          name: "Elena Demo",
          email: "rrhh@workia.local",
          avatar: "",
          initials: "ED",
        }}
      />,
    );

    const form = document.getElementById(SIGN_OUT_FORM_ID);
    expect(form).toBeInstanceOf(HTMLFormElement);
    expect((form as HTMLFormElement).method.toLowerCase()).toBe("post");
    expect((form as HTMLFormElement).action).toContain(SIGN_OUT_PATH);

    const signOutButton = screen.getByLabelText("Cerrar sesión");
    expect(signOutButton.getAttribute("type")).toBe("submit");
    expect(signOutButton.getAttribute("form")).toBe(SIGN_OUT_FORM_ID);
  });
});
