import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/personas/p-1",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/contracts/actions", () => ({
  noRenewContractAction: async () => undefined,
  decideContractRenewalAction: async () => ({}),
  createContractAction: async () => ({}),
}));

import { PersonContractsSection } from "@/components/contracts/person-contracts-section";
import { PersonBajaCard } from "@/components/people/person-baja-card";
import { PersonCredential } from "@/components/people/person-credential";
import {
  DetailCard,
  DetailFieldList,
} from "@/components/people/person-detail-card";
import {
  bajaDetails,
  contractFact,
  employmentPeriodItems,
  ingresoFact,
} from "@/components/people/person-detail-model";
import { PersonEmploymentPeriods } from "@/components/people/person-employment-periods";
import { PersonRehireButton } from "@/components/people/person-rehire-button";
import { PersonSectionNav } from "@/components/people/person-section-nav";
import type { Contract } from "@/lib/db/schema";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const contractWithSalary: Contract = {
  id: "contract-01",
  companyId: "company-01",
  personId: "p-1",
  type: "determinado",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
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
  salarioDiario: "987.65",
  salarioMensual: "29629.50",
  formaPago: null,
  periodicidadPago: null,
  diaPago: null,
  previousContractId: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const personContext = { nombres: "Persona", apellidoPaterno: "Demo" };

describe("DetailFieldList", () => {
  const fields = [
    { label: "RFC", value: "XAXX010101000" },
    {
      label: "CURP",
      value: null,
      section: "identificadores" as const,
      field: "curp",
    },
    {
      label: "NSS",
      value: "",
      section: "identificadores" as const,
      field: "nss",
    },
  ];

  it("lists captured fields and groups the rest under «Falta capturar»", () => {
    render(<DetailFieldList canEdit fields={fields} personId="p-1" />);

    expect(screen.getByText("RFC")).toBeInTheDocument();
    expect(screen.getByText("XAXX010101000")).toBeInTheDocument();
    expect(screen.queryByText("—")).toBeNull();
    expect(screen.getByTestId("missing-fields")).toHaveTextContent(
      "Falta capturar: CURP, NSS",
    );
    expect(screen.getByRole("link", { name: "CURP" })).toHaveAttribute(
      "href",
      "/app/personas/p-1?edit=1&seccion=identificadores&campo=curp",
    );
  });

  it("shows missing fields as plain text without people:update", () => {
    render(<DetailFieldList canEdit={false} fields={fields} personId="p-1" />);

    expect(screen.getByTestId("missing-fields")).toHaveTextContent(
      "Falta capturar: CURP, NSS",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("DetailCard", () => {
  it("is a labelled section with one visible action named after it", () => {
    render(
      <DetailCard
        action={{ label: "Editar", href: "/app/personas/p-1?edit=1" }}
        id="fiscal"
      >
        contenido
      </DetailCard>,
    );

    const card = screen.getByRole("region", { name: "Fiscal e IMSS" });
    expect(card).toHaveAttribute("id", "expediente-fiscal");
    expect(
      screen.getByRole("heading", { level: 2, name: "Fiscal e IMSS" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Editar Fiscal e IMSS" }),
    ).toHaveTextContent("Editar");
  });
});

describe("PersonCredential", () => {
  const facts = [
    { id: "antiguedad" as const, label: "Antigüedad", value: "3 años" },
    { id: "ingreso" as const, label: "Ingreso", value: "12/06/2023" },
    {
      id: "contrato" as const,
      label: "Contrato vigente",
      ...contractFact(
        { typeLabel: "Determinado", endDate: "2026-11-05" },
        "2026-10-21",
        (value) => value,
      ),
    },
    {
      id: "jefe" as const,
      label: "Jefe directo",
      value: "Jefa Demo",
      href: "/app/personas/p-2",
    },
    { id: "horario" as const, label: "Horario", value: "Sin horario" },
  ];

  it("shows the five key facts with the contract's due date", () => {
    render(
      <PersonCredential
        facts={facts}
        header={<h1>Persona Demo</h1>}
        initials="PD"
        status="activa"
      />,
    );

    const strip = screen.getByTestId("person-key-facts");
    expect(strip.querySelectorAll("[data-fact]")).toHaveLength(5);
    expect(strip).toHaveTextContent("Vence en 15 días · 2026-11-05");
    expect(screen.getByRole("link", { name: "Jefa Demo" })).toHaveAttribute(
      "href",
      "/app/personas/p-2",
    );
    expect(screen.getByTestId("person-credential")).toHaveAttribute(
      "data-status",
      "activa",
    );
  });

  it("goes grey for a baja or a deleted expediente", () => {
    const { rerender } = render(
      <PersonCredential facts={[]} header={null} initials="PD" status="baja" />,
    );

    expect(screen.getByTestId("person-credential")).toHaveAttribute(
      "data-status",
      "baja",
    );

    rerender(
      <PersonCredential
        facts={[]}
        header={null}
        initials="PD"
        isDeleted
        status="activa"
      />,
    );
    expect(screen.getByTestId("person-credential")).toHaveAttribute(
      "data-status",
      "borrado",
    );
    expect(screen.queryByTestId("person-key-facts")).toBeNull();
  });

  it("keeps the normal badge for a rehired person, with the period in Ingreso", () => {
    render(
      <PersonCredential
        facts={[
          {
            id: "ingreso",
            label: "Ingreso",
            ...ingresoFact({
              fechaIngreso: "2025-04-01",
              periodCount: 2,
              reconoceAntiguedad: false,
            }),
          },
        ]}
        header={null}
        initials="PD"
        status="activa"
      />,
    );

    expect(screen.getByTestId("person-credential")).toHaveAttribute(
      "data-status",
      "activa",
    );
    expect(screen.getByTestId("person-key-facts")).toHaveTextContent(
      "01/04/20252.º periodo · antigüedad reiniciada",
    );
  });
});

describe("PersonBajaCard", () => {
  it("renders nothing for an active person", () => {
    const { container } = render(<PersonBajaCard status="activa" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a placeholder until the baja details exist", () => {
    render(<PersonBajaCard status="baja" />);

    expect(screen.getByRole("region", { name: "Baja" })).toBeInTheDocument();
    expect(screen.getByTestId("baja-empty")).toBeInTheDocument();
  });

  it("lists the details and the action it is given", () => {
    render(
      <PersonBajaCard
        action={<button type="button">Reingresar</button>}
        details={[
          { label: "Fecha de baja", value: "15/08/2026" },
          { label: "Recontratable", value: "Sí" },
        ]}
        status="baja"
      />,
    );

    expect(screen.queryByTestId("baja-empty")).toBeNull();
    expect(screen.getByText("15/08/2026")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reingresar" }),
    ).toBeInTheDocument();
  });

  const baja = {
    fechaBaja: "2026-06-30",
    bajaSinFecha: false,
    fechaBajaInferida: false,
    requiereRevision: false,
    tipoBaja: "despido" as const,
    motivoBaja: "Bajo desempeño",
    comentarioBaja: null,
    recontratable: false,
    finiquitoEstado: "pendiente" as const,
    finiquitoFecha: null,
    finiquitoMonto: "4321.00",
  };

  it("shows the finiquito amount with compensation:read", () => {
    render(<PersonBajaCard details={bajaDetails(baja, true)} status="baja" />);

    const card = screen.getByRole("region", { name: "Baja" });
    expect(card).toHaveTextContent("Despido");
    expect(card).toHaveTextContent("Bajo desempeño");
    expect(screen.getByTestId("baja-recontratable")).toHaveTextContent("No");
    expect(screen.getByTestId("baja-finiquito-monto")).toHaveTextContent(
      /\$4,321\.00/,
    );
  });

  it("masks it without compensation:read", () => {
    render(<PersonBajaCard details={bajaDetails(baja, false)} status="baja" />);

    expect(screen.getByTestId("baja-finiquito-monto")).toHaveTextContent("•••");
    expect(document.body).not.toHaveTextContent(/4,?321/);
  });

  it("shows a baja without a date for review, and an inferred one", () => {
    const { rerender } = render(
      <PersonBajaCard
        details={bajaDetails(
          {
            ...baja,
            fechaBaja: null,
            bajaSinFecha: true,
            requiereRevision: true,
          },
          true,
        )}
        status="baja"
      />,
    );

    expect(screen.getByTestId("baja-fecha")).toHaveTextContent(
      "Sin fecha, requiere revisión",
    );

    rerender(
      <PersonBajaCard
        details={bajaDetails({ ...baja, fechaBajaInferida: true }, true)}
        status="baja"
      />,
    );
    expect(screen.getByTestId("baja-fecha")).toHaveTextContent(
      "30/06/2026inferida",
    );
  });
});

describe("PersonRehireButton", () => {
  const action = async () => ({});

  it("opens the menu's rehire dialog", () => {
    render(
      <PersonRehireButton
        action={action}
        lastBaja={{ fechaBaja: "2026-06-30", recontratable: true }}
        personName="Persona Demo"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reingresar" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Reingresar a Persona Demo");
    expect(dialog).not.toHaveTextContent("no recontratable");
  });

  it("warns, but still offers it, when the last baja said not rehirable", () => {
    render(
      <PersonRehireButton
        action={action}
        lastBaja={{ fechaBaja: "2026-06-30", recontratable: false }}
        personName="Persona Demo"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reingresar" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("no recontratable");
    expect(
      within(dialog).getByRole("button", { name: "Reingresar" }),
    ).toBeEnabled();
  });
});

describe("PersonEmploymentPeriods", () => {
  it("lists the periods oldest first, amounts masked without permission", () => {
    render(
      <PersonEmploymentPeriods
        items={employmentPeriodItems(
          [
            {
              id: "period-1",
              fechaIngreso: "2020-03-12",
              fechaBaja: "2023-06-30",
              bajaSinFecha: false,
              tipoBaja: "voluntaria",
              motivoBaja: "Cambio de residencia",
              reconoceAntiguedad: false,
              finiquitoEstado: "pagado",
              finiquitoMonto: "8000.00",
            },
            {
              id: "period-2",
              fechaIngreso: "2025-04-01",
              fechaBaja: null,
              bajaSinFecha: false,
              tipoBaja: null,
              motivoBaja: null,
              reconoceAntiguedad: true,
              finiquitoEstado: null,
              finiquitoMonto: null,
            },
          ],
          false,
        )}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("1.º periodo12/03/2020 → 30/06/2023");
    expect(items[0]).toHaveTextContent(
      "Voluntaria · Cambio de residencia · Finiquito pagado: •••",
    );
    expect(items[1]).toHaveTextContent("01/04/2025 → en curso");
    expect(items[1]).toHaveTextContent("Periodo actual · reconoce antigüedad");
    expect(document.body).not.toHaveTextContent(/8,?000/);
  });
});

describe("PersonSectionNav", () => {
  const cards = [
    { id: "identidad" as const, label: "Identidad" },
    { id: "contrato" as const, label: "Contrato" },
  ];

  const renderWithCards = (landOn?: "contrato") =>
    render(
      <div data-slot="shell-main-scroll">
        <PersonSectionNav cards={cards} landOn={landOn} />
        <section id="expediente-identidad" tabIndex={-1} />
        <section id="expediente-contrato" tabIndex={-1} />
      </div>,
    );

  it("scrolls to a card and focuses it; it never switches tabs", () => {
    const scrollBy = vi.fn();
    window.HTMLElement.prototype.scrollBy = scrollBy;
    renderWithCards();

    expect(screen.queryByRole("tab")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Contrato" }));

    expect(scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
    expect(document.activeElement?.id).toBe("expediente-contrato");
  });

  it("does not animate the scroll with reduced motion", () => {
    const scrollBy = vi.fn();
    window.HTMLElement.prototype.scrollBy = scrollBy;
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...matchMedia(query),
      matches: query.includes("reduce"),
    })) as typeof window.matchMedia;

    try {
      renderWithCards();
      fireEvent.click(screen.getByRole("link", { name: "Identidad" }));
      expect(scrollBy).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "auto" }),
      );
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it("lands on a card (?emit=1, ?contract=created) and highlights it", () => {
    vi.useFakeTimers();
    window.HTMLElement.prototype.scrollBy = vi.fn();
    renderWithCards("contrato");

    const card = document.getElementById("expediente-contrato")!;
    expect(document.activeElement).toBe(card);
    expect(card.dataset.highlight).toBe("true");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(card.dataset.highlight).toBeUndefined();
  });
});

describe("PersonContractsSection compensation", () => {
  const renderSection = (canSeeCompensation: boolean) =>
    render(
      <PersonContractsSection
        canCreate={false}
        canSeeCompensation={canSeeCompensation}
        contracts={[contractWithSalary]}
        personContext={personContext}
        personId="p-1"
        showHeading={false}
        templates={[]}
      />,
    );

  it("masks the salary without compensation:read", () => {
    renderSection(false);

    const compensation = screen.getByTestId("contract-compensation");
    expect(compensation).toHaveTextContent(
      "Capturada (requiere el permiso de compensación)",
    );
    expect(document.body).not.toHaveTextContent(/987|29,?629/);
    expect(
      screen.queryByRole("link", { name: "Descargar PDF del contrato" }),
    ).toBeNull();
  });

  it("shows it with compensation:read", () => {
    renderSection(true);

    expect(screen.getByTestId("contract-compensation")).toHaveTextContent(
      /987\.65/,
    );
  });

  it("embedded in the Contrato card it leaves the heading to the card", () => {
    renderSection(false);

    expect(screen.queryByRole("heading", { name: "Contratos" })).toBeNull();
  });

  it("links each contract to its PDF", () => {
    renderSection(true);

    expect(
      screen
        .getAllByRole("link", { name: "Descargar PDF del contrato" })
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/app/personas/p-1/contratos/contract-01/pdf",
      "/app/personas/p-1/contratos/contract-01/pdf",
    ]);
  });
});
