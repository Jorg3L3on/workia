import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/contracts/actions", () => ({
  renewContractAction: async () => ({}),
  noRenewContractAction: async () => undefined,
}));

import { RenewalTrayList } from "@/components/contracts/renewal-tray-list";
import type { Contract, ContractTemplate } from "@/lib/db/schema";

const buildContract = (id: string, personId: string): Contract => ({
  id,
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
  status: "vigente",
  previousContractId: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

const templates: ContractTemplate[] = [
  {
    id: "template-01",
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

describe("RenewalTrayList", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the renewal form collapsed on every row by default", () => {
    render(<RenewalTrayList canUpdate items={items} templates={templates} />);

    expect(screen.getByText("Ana Demo")).toBeTruthy();
    expect(screen.getByText("Luis Demo")).toBeTruthy();
    expect(screen.getByText("2 contratos")).toBeTruthy();
    expect(screen.queryByLabelText("Nuevo tipo")).toBeNull();
    expect(screen.queryByLabelText("Plantilla")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Renovar contrato de Ana Demo" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("opens only the chosen row when renovar is selected", () => {
    render(<RenewalTrayList canUpdate items={items} templates={templates} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Renovar contrato de Ana Demo" }),
    );

    expect(screen.getByLabelText("Nuevo tipo")).toBeTruthy();
    expect(screen.getByLabelText("Plantilla")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Renovar contrato de Ana Demo" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Renovar contrato de Luis Demo" }),
    ).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(
      screen.getByRole("button", { name: "Renovar contrato de Luis Demo" }),
    );

    expect(screen.getAllByLabelText("Nuevo tipo")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Renovar contrato de Luis Demo" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Renovar contrato de Ana Demo" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the form from the tray and keeps no-renovar as a row action", () => {
    render(<RenewalTrayList canUpdate items={items} templates={templates} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Renovar contrato de Ana Demo" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Cerrar formulario de renovación de Ana Demo",
      }),
    );

    expect(screen.queryByLabelText("Nuevo tipo")).toBeNull();
    expect(screen.getAllByRole("button", { name: "No renovar" })).toHaveLength(
      2,
    );
    expect(
      screen.getByRole("link", { name: "Ver expediente de Ana Demo" }),
    ).toBeTruthy();
  });

  it("does not offer renew or no-renew actions without update permission", () => {
    render(
      <RenewalTrayList canUpdate={false} items={items} templates={templates} />,
    );

    expect(
      screen.queryByRole("button", { name: /Renovar contrato de/ }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "No renovar" })).toBeNull();
    expect(screen.queryByLabelText("Nuevo tipo")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Ver expediente de Ana Demo" }),
    ).toBeTruthy();
  });
});
