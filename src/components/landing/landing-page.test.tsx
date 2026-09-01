import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { LandingPage } from "@/components/landing/landing-page";

afterEach(() => {
  cleanup();
});

describe("LandingPage", () => {
  it("treats Contratos and Resguardo as live capabilities", () => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { name: /^Contratos$/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /^Resguardo$/ })).toBeTruthy();
    expect(screen.queryByText("Lo que viene")).toBeNull();
    expect(
      screen.queryByText("En el roadmap — no disponible en producción todavía"),
    ).toBeNull();
  });

  it("includes Contratos and Resguardo in the embedded nav mock", () => {
    render(<LandingPage />);

    const navLabels = [...document.querySelectorAll(".workia-nav-link")].map(
      (item) => item.textContent?.trim(),
    );

    expect(navLabels).toEqual([
      "Inicio",
      "Personas",
      "Contratos",
      "Resguardo",
      "Catálogo",
      "Auditoría",
    ]);
  });
});
