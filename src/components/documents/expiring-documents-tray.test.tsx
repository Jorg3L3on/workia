import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, replace } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/app/documentos",
  useSearchParams: () => new URLSearchParams(),
}));

import Loading from "@/app/app/documentos/loading";
import { ExpiringDocumentsTray } from "@/components/documents/expiring-documents-tray";
import type { ExpiringDocumentRow } from "@/lib/documents/expiring";

const row = (
  id: string,
  extra: Partial<ExpiringDocumentRow> = {},
): ExpiringDocumentRow => ({
  id,
  personId: `person-${id}`,
  personName: id === "hoy" ? "Persona Bandeja" : "Persona Demostración",
  positionId: id === "hoy" ? "puesto-piso" : "puesto-caja",
  positionName: id === "hoy" ? "Puesto Piso" : "Puesto Caja",
  requirementId: `req-${id}`,
  requirementName:
    id === "hoy" ? "Identificación de piso" : "Licencia de demostración",
  deliveredOn: "2026-01-15",
  expiresOn: id === "hoy" ? "2026-10-28" : "2026-11-07",
  status: "expiring",
  ...extra,
});

const positions = [
  { id: "puesto-caja", name: "Puesto Caja" },
  { id: "puesto-piso", name: "Puesto Piso" },
];

afterEach(() => {
  cleanup();
  push.mockReset();
  replace.mockReset();
});

describe("ExpiringDocumentsTray", () => {
  it("shows the rows in the order given and opens the expediente", () => {
    render(
      <ExpiringDocumentsTray
        items={[row("hoy"), row("luego")]}
        positionId=""
        positions={positions}
        status="expiring"
      />,
    );

    const rows = screen.getAllByTestId("expiring-document-row");
    const first = rows[0];
    const second = rows[1];

    expect(first?.textContent).toContain("Persona Bandeja");
    expect(second?.textContent).toContain("Persona Demostración");
    expect(first?.getAttribute("aria-label")).toBe(
      "Ver expediente de Persona Bandeja",
    );
    expect(screen.getByText("07/11/2026")).toBeTruthy();
    expect(screen.getAllByText("Por vencer").length).toBeGreaterThan(0);

    fireEvent.click(first!);
    expect(push).toHaveBeenCalledWith(
      "/app/personas/person-hoy#expediente-documentos",
    );
  });

  it("filters by puesto and by estado", () => {
    render(
      <ExpiringDocumentsTray
        items={[row("hoy")]}
        positionId=""
        positions={positions}
        status="expiring"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Puesto" }));
    fireEvent.click(screen.getByRole("option", { name: "Puesto Piso" }));
    expect(replace).toHaveBeenCalledWith("/app/documentos?puesto=puesto-piso", {
      scroll: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Estado: Por vencer" }));
    fireEvent.click(screen.getByRole("option", { name: "Vencido" }));
    expect(replace).toHaveBeenCalledWith("/app/documentos?estado=vencido", {
      scroll: false,
    });
  });

  it("shows the loading state", () => {
    render(<Loading />);

    expect(
      screen.getByRole("status", { name: "Cargando documentos por vencer" }),
    ).toBeTruthy();
  });

  it("shows the empty state", () => {
    render(
      <ExpiringDocumentsTray
        items={[]}
        positionId=""
        positions={positions}
        status="expiring"
      />,
    );

    expect(screen.getByText("Sin documentos por vencer")).toBeTruthy();
    expect(
      screen.getByText("Nada vence en los próximos 30 días."),
    ).toBeTruthy();
  });

  it("shows the error state", () => {
    render(
      <ExpiringDocumentsTray
        error
        items={[]}
        positionId=""
        positions={[]}
        status="expiring"
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "No se pudieron cargar los documentos por vencer.",
    );
  });
});
