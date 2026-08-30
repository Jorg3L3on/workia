import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TodayDashboard } from "@/components/home/today-dashboard";

describe("TodayDashboard", () => {
  it("explains today focus with useful empty states", () => {
    render(
      <TodayDashboard
        activePeopleCount={0}
        canManagePeople
        canReadContracts
        canReadPeople
        renewalItems={[]}
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

  it("shows urgent badge and renewal items when contracts are due", () => {
    render(
      <TodayDashboard
        activePeopleCount={2}
        canManagePeople={false}
        canReadContracts
        canReadPeople
        renewalItems={[
          {
            contract: {
              id: "c1",
              personId: "p1",
              type: "determinado",
              startDate: "2025-01-01",
              endDate: "2026-09-01",
              noticeWindow: "1",
              templateId: null,
              templateName: "Demo",
              generatedText: "texto",
              scheduleEntrada: null,
              scheduleSalidaComer: null,
              scheduleRegresoComer: null,
              scheduleSalida: null,
              status: "vigente",
              previousContractId: null,
              deletedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            personName: "Ana Demo",
            personId: "p1",
            areaName: "RRHH",
            endDate: "2026-09-01",
            noticeWindow: "1",
          },
        ]}
        urgentCount={1}
      />,
    );

    expect(screen.getByText("1 urgente")).toBeTruthy();
    expect(screen.getByText("Ana Demo")).toBeTruthy();
    expect(screen.getByText("1 pendiente")).toBeTruthy();
  });
});
