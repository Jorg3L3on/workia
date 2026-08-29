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
});
