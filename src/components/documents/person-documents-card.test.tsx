import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DETAIL_CARDS } from "@/components/people/person-detail-model";
import { PersonSectionNav } from "@/components/people/person-section-nav";
import { CompanyProvider } from "@/components/tenant/company-context";
import { buildPersonDocumentCard } from "@/lib/documents/person-card";

import {
  PersonDocumentsCard,
  type RecordDeliveryAction,
} from "./person-documents-card";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const today = "2026-10-28";
const personId = "00000000-0000-4000-8000-0000000000aa";
const companyId = "00000000-0000-4000-8000-0000000000bb";

const fixture = buildPersonDocumentCard(
  [
    {
      id: "req-falta",
      name: "Identificación",
      required: true,
      validityMonths: null,
      sort: 0,
    },
    {
      id: "req-vigente",
      name: "Contrato laboral",
      required: true,
      validityMonths: 12,
      sort: 1,
    },
    {
      id: "req-por-vencer",
      name: "Comprobante de domicilio",
      required: true,
      validityMonths: 6,
      sort: 2,
    },
    {
      id: "req-vencido",
      name: "Examen médico",
      required: true,
      validityMonths: 12,
      sort: 3,
    },
  ],
  [
    {
      personId,
      requirementId: "req-vigente",
      deliveredOn: "2026-01-15",
      expiresOn: "2027-01-15",
    },
    {
      personId,
      requirementId: "req-por-vencer",
      deliveredOn: "2026-10-01",
      expiresOn: "2026-11-20",
    },
    {
      personId,
      requirementId: "req-vencido",
      deliveredOn: "2025-01-01",
      expiresOn: "2026-09-01",
    },
  ],
  today,
);

const renderCard = (
  view: Parameters<typeof PersonDocumentsCard>[0]["view"],
  extra: Partial<Parameters<typeof PersonDocumentsCard>[0]> = {},
) =>
  render(
    <CompanyProvider company={{ id: companyId, name: "Empresa demo" }}>
      <PersonDocumentsCard
        personId={personId}
        today={today}
        view={view}
        {...extra}
      />
    </CompanyProvider>,
  );

const typeDate = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe("PersonDocumentsCard", () => {
  it("shows the four chips for a fixture person", () => {
    renderCard(fixture, { canManage: true, recordAction: vi.fn() });

    const card = screen.getByRole("region", { name: "Documentos" });
    expect(card).toHaveAttribute("id", "expediente-documentos");
    expect(card).toHaveAttribute("data-card", "documentos");
    expect(DETAIL_CARDS.documentos).toBe("Documentos");
    expect(screen.getByTestId("person-documents")).toHaveAttribute(
      "data-state",
      "expired",
    );
    expect(screen.getByTestId("document-message")).toHaveTextContent(
      "Hay documentos vencidos.",
    );

    expect(screen.getByTestId("document-row-req-falta")).toHaveAttribute(
      "data-status",
      "missing",
    );
    expect(screen.getByTestId("document-row-req-falta")).toHaveTextContent(
      "Falta",
    );
    expect(screen.getByTestId("document-row-req-falta")).toHaveTextContent("—");

    expect(screen.getByTestId("document-row-req-vigente")).toHaveAttribute(
      "data-status",
      "valid",
    );
    expect(screen.getByTestId("document-row-req-vigente")).toHaveTextContent(
      "Vigente",
    );
    expect(screen.getByTestId("document-row-req-vigente")).toHaveTextContent(
      "15/01/2026",
    );
    expect(screen.getByTestId("document-row-req-vigente")).toHaveTextContent(
      "15/01/2027",
    );

    expect(screen.getByTestId("document-row-req-por-vencer")).toHaveAttribute(
      "data-status",
      "expiring",
    );
    expect(screen.getByTestId("document-row-req-por-vencer")).toHaveTextContent(
      "Por vencer",
    );

    expect(screen.getByTestId("document-row-req-vencido")).toHaveAttribute(
      "data-status",
      "expired",
    );
    expect(screen.getByTestId("document-row-req-vencido")).toHaveTextContent(
      "Vencido",
    );
    expect(screen.queryByTestId("documents-readonly")).toBeNull();
  });

  it("registers a delivery, updates the chip and refreshes", async () => {
    const recordAction = vi.fn<RecordDeliveryAction>(async () => ({
      ok: true,
    }));
    const missing = buildPersonDocumentCard(
      [
        {
          id: "req-1",
          name: "Identificación",
          required: true,
          validityMonths: 12,
          sort: 0,
        },
      ],
      [],
      today,
    );

    renderCard(missing, { canManage: true, recordAction });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Registrar entrega de Identificación",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Registrar entrega" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/nota/i)).toBeNull();
    expect(screen.queryByLabelText(/archivo/i)).toBeNull();
    expect(screen.queryByLabelText(/número|numero/i)).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();

    typeDate("Fecha de entrega", "15/01/2026");
    expect(screen.getByLabelText("Vencimiento")).toHaveValue("15/01/2027");

    fireEvent.click(screen.getByRole("button", { name: /^Registrar$/ }));

    await waitFor(() => {
      expect(screen.getByTestId("document-row-req-1")).toHaveAttribute(
        "data-status",
        "valid",
      );
    });
    expect(screen.getByTestId("document-row-req-1")).toHaveTextContent(
      "Vigente",
    );
    expect(screen.getByTestId("document-message")).toHaveTextContent(
      "Todo en orden.",
    );
    expect(refresh).toHaveBeenCalled();

    const data = recordAction.mock.calls[0]?.[0];
    expect(data?.get("personId")).toBe(personId);
    expect(data?.get("requirementId")).toBe("req-1");
    expect(data?.get("deliveredOn")).toBe("2026-01-15");
    expect(data?.get("expiresOn")).toBe("2027-01-15");
    expect(data?.get("companyId")).toBe(companyId);
    expect(data?.get("note")).toBeNull();
    expect(data?.get("noVence")).toBeNull();
    expect([...data!.keys()].sort()).toEqual([
      "companyId",
      "deliveredOn",
      "expiresOn",
      "personId",
      "requirementId",
    ]);
  });

  it("lets the user change the suggested expiry", async () => {
    const recordAction = vi.fn<RecordDeliveryAction>(async () => ({
      ok: true,
    }));
    const missing = buildPersonDocumentCard(
      [
        {
          id: "req-1",
          name: "Identificación",
          required: true,
          validityMonths: 12,
          sort: 0,
        },
      ],
      [],
      today,
    );

    renderCard(missing, { canManage: true, recordAction });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Registrar entrega de Identificación",
      }),
    );
    typeDate("Fecha de entrega", "15/01/2026");
    typeDate("Vencimiento", "01/10/2026");
    fireEvent.click(screen.getByRole("button", { name: /^Registrar$/ }));

    await waitFor(() => {
      expect(screen.getByTestId("document-row-req-1")).toHaveAttribute(
        "data-status",
        "expired",
      );
    });
    expect(recordAction.mock.calls[0]?.[0].get("expiresOn")).toBe("2026-10-01");
    expect(screen.getByTestId("document-row-req-1")).toHaveTextContent(
      "Vencido",
    );
  });

  it("stores no expiry when «No vence» is on", async () => {
    const recordAction = vi.fn<RecordDeliveryAction>(async () => ({
      ok: true,
    }));
    const missing = buildPersonDocumentCard(
      [
        {
          id: "req-1",
          name: "Identificación",
          required: true,
          validityMonths: 12,
          sort: 0,
        },
      ],
      [],
      today,
    );

    renderCard(missing, { canManage: true, recordAction });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Registrar entrega de Identificación",
      }),
    );
    typeDate("Fecha de entrega", "15/01/2026");
    fireEvent.click(screen.getByRole("switch", { name: "No vence" }));
    expect(screen.getByLabelText("Vencimiento")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Registrar$/ }));

    await waitFor(() => {
      expect(recordAction).toHaveBeenCalled();
    });
    const data = recordAction.mock.calls[0]?.[0];
    expect(data?.get("noVence")).toBe("on");
    expect(data?.get("expiresOn")).toBeNull();
    expect(screen.getByTestId("document-row-req-1")).toHaveTextContent(
      "Vigente",
    );
    expect(screen.getByTestId("document-row-req-1")).toHaveTextContent(
      "No vence",
    );
  });

  it("does not save an invalid date", async () => {
    const recordAction = vi.fn<RecordDeliveryAction>(async () => ({
      ok: true,
    }));
    const missing = buildPersonDocumentCard(
      [
        {
          id: "req-1",
          name: "Identificación",
          required: true,
          validityMonths: null,
          sort: 0,
        },
      ],
      [],
      today,
    );

    renderCard(missing, { canManage: true, recordAction });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Registrar entrega de Identificación",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Registrar$/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Usa una fecha día/mes/año.",
    );
    expect(recordAction).not.toHaveBeenCalled();
  });

  it("is read-only without documents:manage", () => {
    renderCard(fixture);

    expect(screen.getByTestId("documents-readonly")).toHaveTextContent(
      "Solo lectura.",
    );
    expect(
      screen.queryByRole("button", { name: /Registrar entrega/ }),
    ).toBeNull();
    expect(screen.getByTestId("document-row-req-falta")).toHaveTextContent(
      "Falta",
    );
    expect(screen.getByTestId("document-row-req-vigente")).toHaveTextContent(
      "Vigente",
    );
  });

  it("says the puesto has no requirements", () => {
    renderCard(buildPersonDocumentCard([], [], today), {
      canManage: true,
      recordAction: vi.fn(),
    });

    expect(screen.getByTestId("person-documents")).toHaveAttribute(
      "data-state",
      "empty",
    );
    expect(screen.getByTestId("document-message")).toHaveTextContent(
      "Este puesto no tiene documentos requeridos.",
    );
    expect(
      screen.queryByRole("list", { name: "Documentos del puesto" }),
    ).toBeNull();
  });

  it("shows an error without the register action", () => {
    renderCard({
      state: "error",
      message: "No se pudieron cargar los documentos.",
      rows: [],
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudieron cargar los documentos.",
    );
    expect(screen.getByTestId("person-documents")).toHaveAttribute(
      "data-state",
      "error",
    );
    expect(screen.queryByTestId("documents-readonly")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a loading skeleton", () => {
    renderCard("loading");

    expect(screen.getByTestId("document-skeleton")).toHaveAttribute(
      "aria-label",
      "Cargando documentos",
    );
    expect(screen.queryByTestId("document-message")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Documentos chip", () => {
  it("scrolls to the Documentos card", () => {
    render(
      <div>
        <PersonSectionNav
          cards={[{ id: "documentos", label: DETAIL_CARDS.documentos }]}
        />
        <section id="expediente-documentos" tabIndex={-1} />
      </div>,
    );

    expect(screen.getByRole("link", { name: "Documentos" })).toHaveAttribute(
      "href",
      "#expediente-documentos",
    );
  });
});
