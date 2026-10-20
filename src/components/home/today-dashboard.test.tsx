import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TodayDashboard,
  type TodayDashboardProps,
} from "@/components/home/today-dashboard";
import type { ContractTemplate } from "@/lib/db/schema";

vi.mock("@/lib/contracts/actions", () => ({
  decideContractRenewalAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

const baseProps: TodayDashboardProps = {
  activePeopleCount: 0,
  renewals: { total: 0, items: [] },
  onboardings: { total: 0, items: [] },
  assetsToRecover: { total: 0, items: [] },
  canCreatePeople: true,
  canSeeCompensation: false,
  templates: [],
  positions: [],
  today: "2026-08-20",
};

const renewal = {
  contract: { id: "c1", endDate: "2026-09-01", noticeWindow: "1" as const },
  personName: "Ana Demo",
  personId: "p1",
  areaName: "RRHH",
  endDate: "2026-09-01",
  noticeWindow: "1" as const,
};

const tile = (name: RegExp) => screen.getByRole("link", { name });

describe("TodayDashboard", () => {
  it("shows four linked KPI tiles and one-line empty states", () => {
    render(<TodayDashboard {...baseProps} activePeopleCount={32} />);

    expect(tile(/32\s*Personas activas/).getAttribute("href")).toBe(
      "/app/personas?status=activa",
    );
    expect(tile(/Contratos por vencer/).getAttribute("href")).toBe(
      "/app/contratos",
    );
    expect(tile(/Altas en proceso/).getAttribute("href")).toBe("/app/altas");
    expect(tile(/Equipo pendiente/).getAttribute("href")).toBe(
      "/app/resguardo?status=asignado",
    );
    expect(
      screen.getByText("Ningún contrato en ventana de aviso."),
    ).toBeTruthy();
    expect(screen.getByText("Nada pendiente de recuperar.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Nueva persona/ }).getAttribute("href"),
    ).toBe("/app/personas/nueva");
    expect(screen.queryByText(/Dar de alta/)).toBeNull();
  });

  it("puts urgency on the tile instead of «urgentes» / «pendientes» badges", () => {
    render(
      <TodayDashboard
        {...baseProps}
        renewals={{ total: 8, items: [renewal] }}
      />,
    );

    expect(
      tile(/8\s*Contratos por vencer/).getAttribute("data-attention"),
    ).toBe("true");
    expect(tile(/Personas activas/).getAttribute("data-attention")).toBeNull();
    expect(screen.queryByText(/urgente/)).toBeNull();
    expect(screen.queryByText(/^\d+ pendientes?$/)).toBeNull();
    expect(screen.getByText("Ana Demo")).toBeTruthy();
    expect(screen.getByText("Vence 01/09/2026")).toBeTruthy();
    expect(screen.getByText("7 más")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Atender" })).toBeNull();
  });

  it("opens Decidir renovación from the row when the user can renew", () => {
    render(
      <TodayDashboard
        {...baseProps}
        renewals={{ total: 1, items: [renewal] }}
        templates={[{ id: "t1", name: "Plantilla" } as ContractTemplate]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Decidir renovación de Ana Demo" }),
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("hides what the user may not see", () => {
    render(
      <TodayDashboard
        {...baseProps}
        activePeopleCount={null}
        assetsToRecover={null}
        canCreatePeople={false}
        onboardings={null}
        renewals={null}
      />,
    );

    expect(screen.queryByText("Personas activas")).toBeNull();
    expect(screen.queryByText("Equipo pendiente")).toBeNull();
    expect(screen.queryByRole("link", { name: /Nueva persona/ })).toBeNull();
  });
});
