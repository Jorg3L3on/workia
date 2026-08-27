import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TodayDashboard } from "@/components/home/today-dashboard";

describe("TodayDashboard", () => {
  it("explains today focus with useful empty states", () => {
    render(
      <TodayDashboard
        activePeopleCount={0}
        canManagePeople
        canReadPeople
        urgentCount={0}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Qué hay que atender hoy" }),
    ).toBeTruthy();
    expect(screen.getByText("Nada urgente hoy")).toBeTruthy();
    expect(screen.getByText("Contratos por vencer")).toBeTruthy();
    expect(screen.getByText("Equipo pendiente")).toBeTruthy();
    expect(screen.getByText("Sin vencimientos por ahora")).toBeTruthy();
    expect(screen.getByText("Sin equipo pendiente")).toBeTruthy();
  });

  it("shows urgent badge when items are due today", () => {
    render(
      <TodayDashboard
        activePeopleCount={2}
        canManagePeople={false}
        canReadPeople
        urgentCount={3}
      />,
    );

    expect(screen.getByText("3 urgentes")).toBeTruthy();
  });
});
