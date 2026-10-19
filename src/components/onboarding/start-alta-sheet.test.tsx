import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/onboarding/actions", () => ({
  startOnboardingAction: async () => undefined,
}));

import { StartAltaSheet } from "@/components/onboarding/start-alta-sheet";

const candidates = [
  { id: "p1", name: "Fernando Demo" },
  { id: "p2", name: "Laura Demo" },
];

describe("StartAltaSheet", () => {
  afterEach(cleanup);

  it("opens with an empty picker, so one click cannot start an alta", () => {
    render(<StartAltaSheet candidates={candidates} />);

    fireEvent.click(screen.getByRole("button", { name: "Iniciar alta" }));

    const dialog = screen.getByRole("dialog", { name: "Iniciar alta" });
    expect(dialog.textContent).toContain("Elige una persona");
    expect(
      (
        screen
          .getAllByRole("button", { name: "Iniciar alta" })
          .find((button) => dialog.contains(button)) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
  });

  it("opens preselected when it comes from the expediente", () => {
    render(<StartAltaSheet candidates={candidates} initialPersonId="p2" />);

    const dialog = screen.getByRole("dialog", { name: "Iniciar alta" });
    expect(dialog.textContent).toContain("Laura Demo");
  });
});
