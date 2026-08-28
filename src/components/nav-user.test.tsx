import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    onSelect,
    ...props
  }: {
    children: React.ReactNode;
    onSelect?: (event: { preventDefault: () => void }) => void;
  } & React.ComponentProps<"button">) => (
    <button
      type="button"
      {...props}
      onClick={() => {
        const event = { preventDefault: vi.fn() };
        onSelect?.(event);
      }}
    >
      {children}
    </button>
  ),
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

  it("invokes onSignOut when Cerrar sesión is selected", () => {
    const onSignOut = vi.fn();

    render(
      <NavUser
        user={{
          name: "Elena Demo",
          email: "rrhh@workia.local",
          avatar: "",
          initials: "ED",
        }}
        onSignOut={onSignOut}
      />,
    );

    fireEvent.click(screen.getByLabelText("Cerrar sesión"));

    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
