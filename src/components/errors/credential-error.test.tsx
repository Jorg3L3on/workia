import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: "light",
    setTheme: vi.fn(),
  }),
}));

import NotFound from "@/app/not-found";
import Forbidden from "@/app/forbidden";
import { chromeCopy, errorCopy } from "@/lib/brand/chrome-copy";

afterEach(() => {
  cleanup();
});

describe("Credential error pages", () => {
  it("renders the 404 in Spanish without Next's English default", () => {
    render(<NotFound />);

    expect(
      screen.getByRole("heading", { name: errorCopy.notFoundTitle }),
    ).toBeTruthy();
    expect(screen.getByText(errorCopy.notFoundDescription)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: errorCopy.backToHome }),
    ).toBeTruthy();
    expect(screen.queryByText("This page could not be found")).toBeNull();
    expect(
      screen.getByRole("button", { name: chromeCopy.themeToggle }),
    ).toBeTruthy();
  });

  it("renders the 403 in Spanish without template English", () => {
    render(<Forbidden />);

    expect(
      screen.getByRole("heading", { name: errorCopy.forbiddenTitle }),
    ).toBeTruthy();
    expect(screen.getByText(errorCopy.forbiddenDescription)).toBeTruthy();
    expect(screen.queryByText("Forbidden")).toBeNull();
    expect(
      screen.queryByText("You are not authorized to access this resource."),
    ).toBeNull();
  });
});
