import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DETAIL_CARDS } from "@/components/people/person-detail-model";
import { PersonSectionNav } from "@/components/people/person-section-nav";
import { PersonVacationCard } from "@/components/people/person-vacation-card";
import {
  VACATION_PRIMA_TEXT,
  vacationEntitlementForPerson,
  vacationEntitlementView,
} from "@/lib/people/vacation-card";

afterEach(() => {
  cleanup();
});

const renderCard = (view: Parameters<typeof PersonVacationCard>[0]["view"]) =>
  render(<PersonVacationCard view={view} />);

describe("PersonVacationCard", () => {
  it("is the Vacaciones card and shows the entitlement for a fixture person", () => {
    renderCard(
      vacationEntitlementView({
        seniorityDate: "2023-03-01",
        asOf: "2026-03-02",
        closed: false,
      }),
    );

    const card = screen.getByRole("region", { name: "Vacaciones" });
    expect(card).toHaveAttribute("id", "expediente-vacaciones");
    expect(card).toHaveAttribute("data-card", "vacaciones");
    expect(DETAIL_CARDS.vacaciones).toBe("Vacaciones");
    expect(screen.getByTestId("vacation-service-year")).toHaveTextContent("3");
    expect(card).toHaveTextContent("Aniversario actual");
    expect(card).toHaveTextContent("01/03/2026");
    expect(card).toHaveTextContent("Siguiente aniversario");
    expect(card).toHaveTextContent("01/03/2027");
    expect(screen.getByTestId("vacation-days")).toHaveTextContent("16 días");
    expect(screen.getByTestId("vacation-grant-by")).toHaveTextContent(
      "01/09/2026",
    );
    expect(screen.getByTestId("vacation-prima")).toHaveTextContent(
      VACATION_PRIMA_TEXT,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("hides the grant-by date and says vacations are not due yet", () => {
    renderCard(
      vacationEntitlementView({
        seniorityDate: "2025-06-15",
        asOf: "2026-06-14",
        closed: false,
      }),
    );

    expect(screen.getByTestId("vacation-message")).toHaveTextContent(
      "Aún no genera vacaciones",
    );
    expect(screen.queryByTestId("vacation-grant-by")).toBeNull();
    expect(screen.queryByTestId("vacation-days")).toBeNull();
    expect(screen.queryByTestId("vacation-prima")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Vacaciones" }),
    ).not.toHaveTextContent("15/12/2025");
  });

  it("says there is no hire date", () => {
    renderCard(
      vacationEntitlementView({
        seniorityDate: null,
        asOf: "2026-03-02",
        closed: false,
      }),
    );

    expect(screen.getByTestId("vacation-message")).toHaveTextContent(
      "Sin fecha de ingreso",
    );
    expect(screen.queryByTestId("vacation-service-year")).toBeNull();
    expect(screen.queryByTestId("vacation-prima")).toBeNull();
  });

  it("shows a closed period, including one that ended before a full year", () => {
    const { unmount } = renderCard(
      vacationEntitlementForPerson({
        seniorityDate: "2023-03-01",
        status: "baja",
        fechaBaja: "2026-03-02",
        today: "2026-10-28",
      }),
    );

    expect(screen.getByTestId("vacation-message")).toHaveTextContent(
      "Periodo cerrado",
    );
    expect(screen.getByTestId("vacation-days")).toHaveTextContent("16 días");
    expect(screen.getByTestId("vacation-grant-by")).toBeInTheDocument();
    unmount();

    renderCard(
      vacationEntitlementForPerson({
        seniorityDate: "2025-06-15",
        status: "baja",
        fechaBaja: "2026-01-10",
        today: "2026-10-28",
      }),
    );

    expect(screen.getByTestId("vacation-message")).toHaveTextContent(
      "Periodo cerrado · Aún no genera vacaciones",
    );
    expect(screen.queryByTestId("vacation-grant-by")).toBeNull();
  });

  it("stays neutral before the table applies", () => {
    renderCard(
      vacationEntitlementView({
        seniorityDate: "2020-03-01",
        asOf: "2022-12-31",
        closed: false,
      }),
    );

    const card = screen.getByRole("region", { name: "Vacaciones" });
    expect(screen.getByTestId("vacation-message")).toHaveTextContent(
      "Sin cálculo para esta fecha",
    );
    expect(card).not.toHaveTextContent("pendiente de confirmación");
    expect(card).not.toHaveTextContent("días");
  });

  it("renders a skeleton and an error", () => {
    const { unmount } = renderCard("loading");

    expect(screen.getByTestId("vacation-skeleton")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(
      screen.getByRole("region", { name: "Vacaciones" }),
    ).toBeInTheDocument();
    unmount();

    renderCard(
      vacationEntitlementView({
        seniorityDate: "2023-02-31",
        asOf: "2026-03-02",
        closed: false,
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudo calcular el derecho a vacaciones",
    );
  });

  it("shows a future hire as a neutral status, not an alert", () => {
    renderCard(
      vacationEntitlementView({
        seniorityDate: "2026-04-01",
        asOf: "2026-03-02",
        closed: false,
      }),
    );

    const card = screen.getByRole("region", { name: "Vacaciones" });
    expect(card).toHaveAttribute("data-card", "vacaciones");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Aún no inicia su antigüedad",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByTestId("vacation-days")).toBeNull();
    expect(screen.queryByTestId("vacation-grant-by")).toBeNull();
    expect(screen.queryByTestId("vacation-prima")).toBeNull();
  });

  it("does not put the year-6 caveat on screen", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/people/person-vacation-card.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/pendiente de confirmación|años 6/);
  });
});

describe("Vacaciones chip", () => {
  it("scrolls to the Vacaciones card", () => {
    render(
      <div>
        <PersonSectionNav
          cards={[{ id: "vacaciones", label: DETAIL_CARDS.vacaciones }]}
        />
        <section id="expediente-vacaciones" tabIndex={-1} />
      </div>,
    );

    expect(screen.getByRole("link", { name: "Vacaciones" })).toHaveAttribute(
      "href",
      "#expediente-vacaciones",
    );
  });
});
