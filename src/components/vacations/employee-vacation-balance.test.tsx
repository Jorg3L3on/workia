import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmployeeVacationBalance } from "@/components/vacations/employee-vacation-balance";
import { PersonVacationCard } from "@/components/people/person-vacation-card";
import { composeVacationBalance } from "@/lib/vacations/summary";

afterEach(() => {
  cleanup();
});

const summary = composeVacationBalance({
  seniorityDate: "2023-03-01",
  status: "activa",
  fechaBaja: null,
  today: "2026-11-04",
  records: [
    {
      id: "r1",
      serviceYear: 3,
      startDate: "2026-06-10",
      endDate: "2026-06-14",
      days: "5.0",
    },
    {
      id: "r2",
      serviceYear: 2,
      startDate: "2025-06-02",
      endDate: "2025-06-03",
      days: "1.5",
    },
  ],
});

describe("EmployeeVacationBalance", () => {
  it("shows the current balance, the years and the days taken", () => {
    render(
      <EmployeeVacationBalance
        constanciaHref={(year) => `/mi/vacaciones/constancia?anio=${year}`}
        summary={summary}
      />,
    );

    const card = screen.getByRole("region", { name: "Mis vacaciones" });
    expect(screen.getByTestId("vacation-remaining")).toHaveTextContent(
      "11 días",
    );
    expect(screen.getByTestId("vacation-days")).toHaveTextContent("16 días");
    expect(screen.getByTestId("vacation-taken")).toHaveTextContent("5 días");
    expect(screen.getByTestId("vacation-grant-by")).toHaveTextContent(
      "01/09/2026",
    );

    const year2 = screen.getByTestId("vacation-year-2");
    expect(year2).toHaveTextContent("Año 2");
    expect(year2).toHaveTextContent("14 días");
    expect(
      within(year2).getByTestId("vacation-year-remaining"),
    ).toHaveTextContent("12,5 días");
    expect(
      within(year2).getByRole("link", { name: "Constancia" }),
    ).toHaveAttribute("href", "/mi/vacaciones/constancia?anio=2");

    const history = screen.getByTestId("vacation-history");
    expect(history).toHaveTextContent("10/06/2026 – 14/06/2026");
    expect(history).toHaveTextContent("1,5 días");

    // Days only.
    expect(card.textContent).not.toMatch(/prima|\$|pago|monto/i);
  });

  it("shows the same balance as the HR card for the same person", () => {
    render(
      <>
        <EmployeeVacationBalance summary={summary} />
        <PersonVacationCard
          ledger={{
            showHistory: false,
            records: [],
            existing: [],
            takenHalves: summary.current?.takenHalves ?? null,
            remainingHalves: summary.current?.remainingHalves ?? null,
            exceedsEntitlement: summary.current?.exceedsEntitlement ?? false,
            canCreate: false,
            canVoid: false,
            personId: "00000000-0000-4000-8000-000000000000",
            periods: [],
            fallbackFechaIngreso: null,
            registerAction: async () => ({}),
            voidAction: async () => ({}),
          }}
          view={summary.view}
        />
      </>,
    );

    const employee = screen.getByRole("region", { name: "Mis vacaciones" });
    const hr = screen.getByRole("region", { name: "Vacaciones" });

    for (const id of ["vacation-days", "vacation-taken", "vacation-grant-by"]) {
      expect(
        within(employee).getByTestId(id).querySelector("dd")?.textContent,
      ).toBe(within(hr).getByTestId(id).querySelector("dd")?.textContent);
    }
    expect(
      within(hr).getByTestId("vacation-remaining").querySelector("dd")
        ?.textContent,
    ).toBe("11 días");
    expect(
      within(employee).getByTestId("vacation-remaining"),
    ).toHaveTextContent("11 días");
  });

  it("explains a person without a full year and has no balance", () => {
    render(
      <EmployeeVacationBalance
        summary={composeVacationBalance({
          seniorityDate: "2026-03-01",
          status: "activa",
          fechaBaja: null,
          today: "2026-11-04",
          records: [],
        })}
      />,
    );

    expect(screen.getByTestId("vacation-message")).toHaveTextContent(
      "Aún no genera vacaciones",
    );
    expect(screen.queryByTestId("vacation-remaining")).toBeNull();
    expect(screen.getByText("Sin vacaciones registradas.")).toBeInTheDocument();
  });
});
