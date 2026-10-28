import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/lib/documents/actions", () => ({
  setRequirementsAction: async () => ({ ok: true as const }),
}));

vi.mock("@/lib/catalog/actions", () => ({
  createActivityAction: async () => undefined,
  createAreaAction: async () => undefined,
  createPositionAction: async () => undefined,
  deleteActivityAction: async () => undefined,
  deleteAreaAction: async () => undefined,
  deletePositionAction: async () => undefined,
  updateActivityAction: async () => undefined,
  updateAreaAction: async () => undefined,
  updatePositionAction: async () => undefined,
}));
vi.mock("@/lib/regions/actions", () => ({
  createRegionAction: async () => undefined,
  deleteRegionAction: async () => undefined,
  updateRegionAction: async () => undefined,
}));
vi.mock("@/lib/termination-reasons/actions", () => ({
  createTerminationReasonAction: async () => undefined,
  deleteTerminationReasonAction: async () => undefined,
  updateTerminationReasonAction: async () => undefined,
}));
vi.mock("@/lib/sites/actions", () => ({
  createSiteAction: async () => undefined,
  deleteSiteAction: async () => undefined,
  updateSiteAction: async () => undefined,
}));

import { describeReferences } from "@/components/catalog/catalog-page";
import {
  AreasCatalog,
  PuestosCatalog,
  SucursalesCatalog,
  type AreaCatalogRow,
  type PositionCatalogRow,
  type PositionDocumentRequirement,
} from "@/components/catalog/catalog-entities";

const permissions = { canCreate: true, canUpdate: true, canDelete: true };

const position = (
  id: string,
  name: string,
  overrides: Partial<PositionCatalogRow> = {},
): PositionCatalogRow => ({
  id,
  name,
  active: true,
  areaId: null,
  areaName: null,
  activities: [],
  references: [{ count: 0, one: "persona", many: "personas" }],
  documents: [],
  ...overrides,
});

const positions = [
  position("p1", "Analista", {
    areaName: "Operaciones",
    areaId: "a1",
    activities: [{ id: "x1", name: "Reportes" }],
  }),
  position("p2", "Coordinador", { active: false }),
  position("p3", "Auxiliar", {
    references: [{ count: 3, one: "persona", many: "personas" }],
  }),
];

const activities = [
  { id: "x1", name: "Reportes" },
  { id: "x2", name: "Atención a solicitudes" },
];

const table = () => within(screen.getByRole("table"));

const openMenu = (name: string) => {
  fireEvent.pointerDown(
    table().getByRole("button", { name: `Acciones de ${name}` }),
    { button: 0, ctrlKey: false },
  );
  return screen.getAllByRole("menuitem").map((item) => item.textContent);
};

const renderPuestos = (
  extra: Partial<Parameters<typeof PuestosCatalog>[0]> = {},
) =>
  render(
    <PuestosCatalog
      activities={activities}
      areas={[{ id: "a1", name: "Operaciones" }]}
      canManageDocuments
      rows={positions}
      {...permissions}
      {...extra}
    />,
  );

describe("CatalogPage", () => {
  afterEach(cleanup);

  it("shows active rows by default and every row with «Todos»", () => {
    renderPuestos();

    expect(table().queryByText("Coordinador")).toBeNull();
    expect(table().getByText("Analista")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(table().getByText("Coordinador")).toBeTruthy();
    expect(table().getByText("Inactivo")).toBeTruthy();
  });

  it("has no inputs, selects or text buttons inside rows", () => {
    renderPuestos();

    expect(table().queryAllByRole("textbox")).toEqual([]);
    expect(table().queryAllByRole("combobox")).toEqual([]);
    expect(table().queryByText("Quitar")).toBeNull();
    expect(screen.queryByText("Asignar actividad")).toBeNull();
    // Activities show as tags in the cell.
    expect(table().getByText("Reportes")).toBeTruthy();
  });

  it("offers Eliminar only when nothing points at the record", () => {
    renderPuestos();

    expect(openMenu("Analista")).toEqual([
      "Editar",
      "Documentos requeridos",
      "Desactivar",
      "Eliminar",
    ]);
    cleanup();
    renderPuestos();
    expect(openMenu("Auxiliar")).toEqual([
      "Editar",
      "Documentos requeridos",
      "Desactivar",
    ]);
  });

  it("edits a puesto in a sheet with its activities as chips", () => {
    renderPuestos();

    fireEvent.click(table().getByRole("button", { name: "Editar Analista" }));

    const sheet = screen.getByRole("dialog", { name: "Editar puesto" });
    expect(
      (within(sheet).getByLabelText("Nombre") as HTMLInputElement).value,
    ).toBe("Analista");
    const chips = within(sheet).getByRole("list", {
      name: "Actividades del puesto",
    });
    expect(within(chips).getByText("Reportes")).toBeTruthy();

    fireEvent.click(
      within(sheet).getByRole("button", { name: "Quitar Reportes" }),
    );
    expect(within(chips).queryByText("Reportes")).toBeNull();

    fireEvent.click(within(sheet).getByRole("button", { name: "Agregar" }));
    fireEvent.click(
      screen.getByRole("option", { name: "Atención a solicitudes" }),
    );
    expect(within(chips).getByText("Atención a solicitudes")).toBeTruthy();
    expect(
      within(sheet).getByRole("button", { name: "Guardar cambios" }),
    ).toBeTruthy();
    expect(
      within(sheet).getByRole("button", { name: "Cancelar" }),
    ).toBeTruthy();
  });

  it("opens an empty sheet from «Nuevo puesto»", () => {
    renderPuestos();

    fireEvent.click(screen.getByRole("button", { name: "Nuevo puesto" }));

    const sheet = screen.getByRole("dialog", { name: "Nuevo puesto" });
    expect(
      (within(sheet).getByLabelText("Nombre") as HTMLInputElement).value,
    ).toBe("");
    expect(
      within(sheet).getByRole("button", { name: "Crear puesto" }),
    ).toBeTruthy();
  });

  it("indents áreas by level and keeps a sub-area out of its own parents", () => {
    const area = (
      id: string,
      name: string,
      depth: number,
      subtreeIds: string[],
    ): AreaCatalogRow => ({
      id,
      name,
      active: true,
      depth,
      parentAreaId: depth ? "a1" : null,
      subtreeIds,
      positionCount: 0,
      references: [],
    });

    render(
      <AreasCatalog
        parents={[
          { id: "a1", name: "Dirección" },
          { id: "a2", name: "Finanzas" },
        ]}
        rows={[
          area("a1", "Dirección", 0, ["a1", "a2"]),
          area("a2", "Finanzas", 1, ["a2"]),
        ]}
        {...permissions}
      />,
    );

    expect(table().getByTitle("Finanzas").style.paddingLeft).toBe("1.25rem");
    expect(table().getByTitle("Dirección").style.paddingLeft).toBe("0rem");
  });

  it("has no status toggle nor Desactivar for sucursales", () => {
    render(
      <SucursalesCatalog
        regions={[{ id: "r1", name: "Norte" }]}
        rows={[
          {
            id: "s1",
            name: "Sucursal Norte",
            active: true,
            kind: "sucursal",
            regionId: "r1",
            regionName: "Norte",
            references: [],
          },
        ]}
        {...permissions}
      />,
    );

    expect(screen.queryByRole("group", { name: "Estado" })).toBeNull();
    expect(openMenu("Sucursal Norte")).toEqual(["Editar", "Eliminar"]);
  });

  const paper = (
    id: string,
    name: string,
    extra: Partial<PositionDocumentRequirement> = {},
  ): PositionDocumentRequirement => ({
    id,
    name,
    required: true,
    validityMonths: null,
    sort: 0,
    active: true,
    ...extra,
  });

  const openDocuments = (name: string) => {
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Documentos requeridos" }),
    );
    const sheet = screen.getByRole("dialog", { name: "Documentos requeridos" });
    expect(within(sheet).getByText(name)).toBeTruthy();
    return sheet;
  };

  it("shows an empty documents section for a puesto", () => {
    renderPuestos();
    openMenu("Analista");

    const sheet = openDocuments("Analista");

    expect(
      within(sheet).getByText("Este puesto no tiene documentos requeridos."),
    ).toBeTruthy();
    expect(
      within(sheet).getByRole("button", { name: "Agregar documento" }),
    ).toBeTruthy();
    expect(within(sheet).queryByRole("list")).toBeNull();
  });

  it("lists one and many required documents and counts them", () => {
    renderPuestos({
      rows: [
        position("p1", "Analista", {
          documents: [paper("d1", "Identificación")],
        }),
        position("p2", "Coordinador", {
          documents: [
            paper("d2", "Domicilio", { validityMonths: 12, sort: 0 }),
            paper("d3", "Contrato", {
              required: false,
              validityMonths: 24,
              sort: 1,
            }),
          ],
        }),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(table().getByText("1")).toBeTruthy();
    expect(table().getByText("2")).toBeTruthy();

    openMenu("Analista");
    const one = openDocuments("Analista");
    expect(within(one).getAllByRole("listitem")).toHaveLength(1);
    expect(within(one).getByLabelText("Nombre")).toHaveProperty(
      "value",
      "Identificación",
    );
    expect(
      (
        within(one).getByRole("button", {
          name: "Subir Identificación",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        within(one).getByRole("button", {
          name: "Bajar Identificación",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    cleanup();
    renderPuestos({
      rows: [
        position("p2", "Coordinador", {
          documents: [
            paper("d2", "Domicilio", { validityMonths: 12 }),
            paper("d3", "Contrato", { required: false, sort: 1 }),
          ],
        }),
      ],
    });
    openMenu("Coordinador");
    const many = openDocuments("Coordinador");
    expect(within(many).getAllByRole("listitem")).toHaveLength(2);
    expect(within(many).getByDisplayValue("Domicilio")).toBeTruthy();
    expect(within(many).getByDisplayValue("Contrato")).toBeTruthy();
    expect(within(many).queryByLabelText("Nota")).toBeNull();
    expect(within(many).queryByLabelText("Archivo")).toBeNull();
    expect(within(many).queryByLabelText("Número de documento")).toBeNull();
  });

  it("shows the documents list read-only without documents:manage", () => {
    renderPuestos({
      canManageDocuments: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      rows: [
        position("p1", "Analista", {
          documents: [
            paper("d1", "Identificación", { validityMonths: 12 }),
            paper("d2", "Comprobante", {
              required: false,
              active: false,
              sort: 1,
            }),
          ],
        }),
      ],
    });

    expect(openMenu("Analista")).toEqual(["Documentos requeridos"]);
    const sheet = openDocuments("Analista");

    expect(within(sheet).getByText("Solo lectura.")).toBeTruthy();
    expect(within(sheet).getByText("Identificación")).toBeTruthy();
    expect(within(sheet).getByText("Obligatorio · 12 meses")).toBeTruthy();
    expect(
      within(sheet).getByText("Opcional · No vence · Inactivo"),
    ).toBeTruthy();
    expect(within(sheet).queryByRole("textbox")).toBeNull();
    expect(
      within(sheet).queryByRole("button", { name: "Agregar documento" }),
    ).toBeNull();
    expect(
      within(sheet).queryByRole("button", { name: "Guardar documentos" }),
    ).toBeNull();
  });

  it("names the references", () => {
    expect(
      describeReferences([
        { count: 3, one: "persona", many: "personas" },
        { count: 0, one: "puesto", many: "puestos" },
        { count: 1, one: "sub-área", many: "sub-áreas" },
      ]),
    ).toBe("3 personas y 1 sub-área");
  });
});
