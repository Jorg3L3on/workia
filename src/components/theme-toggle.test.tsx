import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: "light",
    setTheme,
  }),
}));

import { ThemeToggle } from "@/components/theme-toggle";
import { chromeCopy } from "@/lib/brand/chrome-copy";

afterEach(() => {
  cleanup();
  setTheme.mockReset();
});

describe("ThemeToggle", () => {
  it("exposes a Spanish aria-label and does not say Toggle theme", () => {
    render(<ThemeToggle />);

    expect(
      screen.getByRole("button", { name: chromeCopy.themeToggle }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Toggle theme")).toBeNull();
  });

  it("still switches between light and dark", () => {
    render(<ThemeToggle />);

    fireEvent.click(
      screen.getByRole("button", { name: chromeCopy.themeToggle }),
    );

    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
