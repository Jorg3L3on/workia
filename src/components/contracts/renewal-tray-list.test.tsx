import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/contracts/actions", () => ({
  renewContractAction: async () => ({}),
  noRenewContractAction: async () => undefined,
  decideContractRenewalAction: async () => ({}),
}));

import { RenewalTrayList } from "@/components/contracts/renewal-tray-list";
import type { Contract, ContractTemplate } from "@/lib/db/schema";

const buildContract = (id: string, personId: string): Contract => ({
  id,
  companyId: "company-01",
  personId,
  type: "determinado",
  startDate: "2026-01-01",
  endDate: "2026-09-15",
  noticeWindow: "1",
  templateId: "template-01",
  templateName: "Plantilla demo",
  generatedText: "texto demo",
  scheduleEntrada: null,
  scheduleSalidaComer: null,
  scheduleRegresoComer: null,
  scheduleSalida: null,
  scheduleBlocks: null,
  scheduleRestDay: null,
  noRenewReason: null,
  status: "vigente",
  salarioDiario: null,
  salarioMensual: null,
  formaPago: null,
  periodicidadPago: null,
  diaPago: null,
  previousContractId: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

const templates: ContractTemplate[] = [
  {
    id: "template-01",
    companyId: "company-01",
    name: "Plantilla demo",
    body: "Cuerpo demo",
    active: true,
    deletedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  },
];

const items = [
  {
    contract: buildContract("contract-ana", "person-ana"),
    personName: "Ana Demo",
    personId: "person-ana",
    endDate: "2026-09-15",
    noticeWindow: "1" as const,
  },
  {
    contract: buildContract("contract-luis", "person-luis"),
    personName: "Luis Demo",
    personId: "person-luis",
    endDate: "2026-10-01",
    noticeWindow: "2" as const,
  },
];

const openMenu = (name: string) => {
  fireEvent.pointerDown(
    within(screen.getByRole("table")).getByRole("button", {
      name: `Acciones de ${name}`,
    }),
    { button: 0, ctrlKey: false },
  );
};

const renderTray = (canUpdate = true) =>
  render(
    <RenewalTrayList
      canUpdate={canUpdate}
      items={items}
      templates={templates}
      today="2026-09-10"
    />,
  );

describe("RenewalTrayList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a status per contract and one inline action: Decidir renovación", () => {
    renderTray();
    const table = within(screen.getByRole("table"));

    expect(table.getByText("Ana Demo")).toBeTruthy();
    expect(table.getByText("En 5 días")).toBeTruthy();
    expect(table.getByText("En 21 días")).toBeTruthy();
    expect(screen.getByText("1–2 de 2")).toBeTruthy();
    expect(
      table.getAllByRole("button", { name: /^Decidir renovación de / }),
    ).toHaveLength(2);
    // No text actions left in the row.
    expect(table.queryByRole("button", { name: /^Renovar/ })).toBeNull();
    expect(table.queryByRole("link", { name: "Ver expediente" })).toBeNull();
  });

  it("opens the Decidir dialog from the inline action", () => {
    renderTray();

    fireEvent.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: "Decidir renovación de Ana Demo",
      }),
    );

    expect(
      screen.getByRole("dialog", { name: "Decidir renovación" }),
    ).toBeTruthy();
  });

  it("keeps the Renovar panel behind the menu and opens one row at a time", () => {
    renderTray();

    expect(screen.queryByLabelText("Nuevo tipo")).toBeNull();

    openMenu("Ana Demo");
    fireEvent.click(screen.getByRole("menuitem", { name: "Renovar contrato" }));

    expect(screen.getAllByLabelText("Nuevo tipo").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getAllByRole("button", {
        name: "Cerrar formulario de renovación de Ana Demo",
      })[0],
    );

    expect(screen.queryByLabelText("Nuevo tipo")).toBeNull();
  });

  it("offers only Ver expediente without update permission", () => {
    renderTray(false);

    expect(
      screen.queryByRole("button", { name: /Decidir renovación de/ }),
    ).toBeNull();

    openMenu("Ana Demo");

    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Ver expediente"]);
  });
});
