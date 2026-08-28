import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIGN_OUT_FORM_ID, SIGN_OUT_PATH } from "@/lib/auth/client-sign-out";
import { LOGOUT_LATCH_COOKIE_NAME } from "@/lib/auth/logout-latch";

afterEach(() => {
  cleanup();
  document.cookie = `${LOGOUT_LATCH_COOKIE_NAME}=; Path=/; Max-Age=0`;
  vi.restoreAllMocks();
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
    onSelect?: (event: Event) => void;
  } & React.ComponentProps<"button">) => (
    <button
      type="button"
      {...props}
      onClick={() => {
        const event = new Event("select");
        const preventDefault = vi.fn();
        Object.defineProperty(event, "preventDefault", {
          value: preventDefault,
        });
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

  it("keeps a mounted native POST form outside the dropdown menu", () => {
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
  });

  it("native-submits the mounted form with prototype.submit, not requestSubmit", () => {
    const submitSpy = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    const requestSubmitSpy = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});

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

    const form = document.getElementById(SIGN_OUT_FORM_ID);
    expect(document.cookie).toContain(`${LOGOUT_LATCH_COOKIE_NAME}=1`);
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(submitSpy.mock.instances[0]).toBe(form);
    expect(requestSubmitSpy).not.toHaveBeenCalled();
  });
});
