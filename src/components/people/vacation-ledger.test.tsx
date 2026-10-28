import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PersonVacationCard } from "@/components/people/person-vacation-card";
import type { VacationLedgerModel } from "@/components/people/vacation-ledger";
import { vacationEntitlementView } from "@/lib/people/vacation-card";
import { VACATION_COPY } from "@/lib/vacations/balance";
import type { VacationHistoryItem } from "@/lib/vacations/types";

afterEach(() => {
  cleanup();
});

const periods: VacationLedgerModel["periods"] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    fechaIngreso: "2023-03-01",
    fechaBaja: null,
    bajaSinFecha: false,
    reconoceAntiguedad: false,
    fechaAntiguedadReconocida: null,
  },
];

const record = (
  id: string,
  startDate: string,
  endDate: string,
  days: string,
): VacationHistoryItem => ({
  id,
  startDate,
  endDate,
  days,
  serviceYear: 3,
  note: null,
  createdByName: "RH Fixture",
});

const entitled = vacationEntitlementView({
  seniorityDate: "2023-03-01",
  asOf: "2026-06-10",
  closed: false,
});

const ledger = (
  records: VacationHistoryItem[],
  extras: Partial<
    VacationLedgerModel & {
      takenHalves: number | null;
      remainingHalves: number | null;
      exceedsEntitlement: boolean;
    }
  > = {},
) => ({
  showHistory: true,
  records,
  existing: records.map((item) => ({
    startDate: item.startDate,
    endDate: item.endDate,
    serviceYear: item.serviceYear,
    days: item.days,
    voided: false,
  })),
  canCreate: true,
  canVoid: true,
  personId: "00000000-0000-4000-8000-000000000010",
  periods,
  fallbackFechaIngreso: "2023-03-01",
  registerAction: vi.fn(async () => ({})),
  voidAction: vi.fn(async () => ({})),
  takenHalves: 0,
  remainingHalves: 32,
  exceedsEntitlement: false,
  ...extras,
});

const renderLedger = (model: ReturnType<typeof ledger>) =>
  render(<PersonVacationCard ledger={model} view={entitled} />);

const typeDate = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

describe("vacation history", () => {
  it("shows an empty history", () => {
    renderLedger(ledger([]));

    expect(screen.getByText(VACATION_COPY.emptyHistory)).toBeInTheDocument();
    expect(screen.getByTestId("vacation-taken")).toHaveTextContent("0 días");
    expect(screen.getByTestId("vacation-remaining")).toHaveTextContent(
      "16 días",
    );
    expect(
      document.querySelector("[data-history='empty']"),
    ).toBeInTheDocument();
  });

  it("shows one record and the balance after five days", () => {
    renderLedger(
      ledger([record("r1", "2026-06-10", "2026-06-14", "5.0")], {
        takenHalves: 10,
        remainingHalves: 22,
      }),
    );

    expect(screen.getAllByTestId("vacation-history-item")).toHaveLength(1);
    expect(screen.getByTestId("vacation-history-item")).toHaveTextContent(
      "10/06/2026 al 14/06/2026",
    );
    expect(screen.getByTestId("vacation-history-item")).toHaveTextContent(
      "5 días",
    );
    expect(screen.getByTestId("vacation-history-item")).toHaveTextContent(
      "RH Fixture",
    );
    expect(screen.getByTestId("vacation-remaining")).toHaveTextContent(
      "11 días",
    );
    expect(document.querySelector("[data-history='one']")).toBeInTheDocument();
  });

  it("shows many records", () => {
    renderLedger(
      ledger([
        record("r1", "2026-06-10", "2026-06-14", "5.0"),
        record("r2", "2026-08-01", "2026-08-02", "1.5"),
      ]),
    );

    expect(screen.getAllByTestId("vacation-history-item")).toHaveLength(2);
    expect(screen.getByText(/0,5|1,5/)).toBeInTheDocument();
    expect(document.querySelector("[data-history='many']")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Anular vacaciones/ }),
    ).toHaveLength(2);
  });
});

describe("Registrar vacaciones", () => {
  it("shows a validation error and does not call the action", async () => {
    const model = ledger([]);
    renderLedger(model);

    fireEvent.click(
      screen.getByRole("button", { name: "Registrar vacaciones" }),
    );
    expect(
      screen.getByRole("heading", { name: "Registrar vacaciones" }),
    ).toBeInTheDocument();

    typeDate("Inicio", "10/06/2026");
    typeDate("Fin", "14/06/2026");
    fireEvent.change(screen.getByLabelText("Días"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      VACATION_COPY.days,
    );
    expect(model.registerAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Registrar" })).toBeEnabled();
  });

  it("shows the saving state while the action is in flight", async () => {
    let release: (value: { ok: true }) => void = () => {};
    const model = ledger([], {
      registerAction: vi.fn(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            release = resolve;
          }),
      ),
    });
    renderLedger(model);

    fireEvent.click(
      screen.getByRole("button", { name: "Registrar vacaciones" }),
    );
    typeDate("Inicio", "10/06/2026");
    typeDate("Fin", "14/06/2026");
    fireEvent.change(screen.getByLabelText("Días"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));

    expect(
      await screen.findByRole("button", { name: "Guardando…" }),
    ).toBeDisabled();
    release({ ok: true });
  });

  it("warns above the entitlement and still allows saving", async () => {
    const model = ledger([]);
    renderLedger(model);

    fireEvent.click(
      screen.getByRole("button", { name: "Registrar vacaciones" }),
    );
    typeDate("Inicio", "10/06/2026");
    typeDate("Fin", "20/06/2026");
    fireEvent.change(screen.getByLabelText("Días"), {
      target: { value: "20" },
    });

    expect(
      await screen.findByTestId("vacation-dialog-warning"),
    ).toHaveTextContent(VACATION_COPY.over);
    expect(screen.getByRole("button", { name: "Registrar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(model.registerAction).toHaveBeenCalled();
  });

  it("does not offer paying instead of resting", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/people/vacation-ledger.tsx"),
      "utf8",
    );

    expect(source).toMatch(/pendiente de contador/);
    expect(source.toLowerCase()).not.toMatch(
      /pagar|pago de vacaciones|en lugar de descansar|en efectivo/,
    );

    renderLedger(ledger([]));
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar vacaciones" }),
    );

    expect(screen.getByRole("dialog").textContent?.toLowerCase()).not.toMatch(
      /pagar|pago|efectivo/,
    );
  });
});
