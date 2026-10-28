import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { VacationConstanciaDocument } from "@/components/people/vacation-constancia";
import type { VacationConstancia } from "@/lib/vacations/constancia-sheet";

afterEach(() => {
  cleanup();
});

const sheet: VacationConstancia = {
  companyName: "Empresa Demostración SA",
  personName: "Ana Demostración",
  seniorityDate: "2023-03-01",
  serviceYear: 3,
  entitlementDays: 16,
  takenHalves: 10,
  grantBy: "2026-09-01",
  issuedOn: "2026-10-28",
  ranges: [{ startDate: "2026-06-10", endDate: "2026-06-14", days: "5" }],
};

describe("VacationConstanciaDocument", () => {
  it("shows every field of one service year on a single sheet", () => {
    render(<VacationConstanciaDocument constancia={sheet} />);

    const article = screen.getByTestId("vacation-constancia");
    expect(article).toHaveAttribute("aria-label", "Constancia de vacaciones");
    expect(screen.getByTestId("vacation-constancia-company")).toHaveTextContent(
      "Empresa Demostración SA",
    );
    expect(screen.getByTestId("vacation-constancia-person")).toHaveTextContent(
      "Ana Demostración",
    );
    expect(
      screen.getByTestId("vacation-constancia-seniority"),
    ).toHaveTextContent("01/03/2023");
    expect(screen.getByTestId("vacation-constancia-year")).toHaveTextContent(
      "3",
    );
    expect(
      screen.getByTestId("vacation-constancia-entitlement"),
    ).toHaveTextContent("16 días");
    expect(screen.getByTestId("vacation-constancia-taken")).toHaveTextContent(
      "5 días",
    );
    expect(
      screen.getByTestId("vacation-constancia-grant-by"),
    ).toHaveTextContent("01/09/2026");
    expect(screen.getByTestId("vacation-constancia-ranges")).toHaveTextContent(
      "10/06/2026 al 14/06/2026 · 5 días",
    );
    expect(screen.getByTestId("vacation-constancia-issued")).toHaveTextContent(
      "28/10/2026",
    );
    expect(
      screen.getByTestId("vacation-constancia-signatures"),
    ).toHaveTextContent("Nombre y firma de quien expide");
    expect(
      screen.getByTestId("vacation-constancia-signatures"),
    ).toHaveTextContent("Firma de la persona trabajadora");
    expect(screen.getByRole("button", { name: "Imprimir" })).toBeTruthy();
    expect(article).not.toHaveTextContent("Art.");
    expect(article).not.toHaveTextContent("pagar");
  });
});
