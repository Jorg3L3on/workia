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
  useRouter: () => ({
    push,
  }),
}));

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
    onSelect?: (event: Event) => void;
  } & React.ComponentProps<"button">) => (
    <button
      type="button"
      {...props}
      onClick={() => {
        const event = new Event("select");
        onSelect?.(event);
      }}
    >
      {children}
    </button>
  ),
}));

import { NavUser } from "@/components/nav-user";

afterEach(() => {
  cleanup();
  signOut.mockReset();
  push.mockReset();
  vi.restoreAllMocks();
});

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

  it("does not mount a custom POST logout form", () => {
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

    expect(document.querySelector("form")).toBeNull();
  });

  it("calls Auth.js signOut then navigates to /login", async () => {
    signOut.mockResolvedValue(undefined);

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

    fireEvent.click(screen.getByLabelText("Cerrar sesión"));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledWith({ redirect: false });
    });
    expect(push).toHaveBeenCalledWith("/login");
  });
});
