import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { DataTable, type DataTableColumn } from "@/components/list/data-table";

type CatalogRow = {
  id: string;
  name: string;
  code: string;
  status: string;
};

const rows: CatalogRow[] = [
  { id: "row-01", name: "Zulu item", code: "C-03", status: "Inactivo" },
  { id: "row-02", name: "Alpha item", code: "A-01", status: "Activo" },
  { id: "row-03", name: "Mike item", code: "B-02", status: "Activo" },
  { id: "row-04", name: "Delta item", code: "A-04", status: "Activo" },
  { id: "row-05", name: "Echo item", code: "B-05", status: "Inactivo" },
  { id: "row-06", name: "Foxtrot item", code: "C-06", status: "Activo" },
  { id: "row-07", name: "Golf item", code: "A-07", status: "Activo" },
  { id: "row-08", name: "Hotel item", code: "B-08", status: "Activo" },
  { id: "row-09", name: "India item", code: "C-09", status: "Inactivo" },
  { id: "row-10", name: "Juliet item", code: "A-10", status: "Activo" },
  { id: "row-11", name: "Kilo item", code: "B-11", status: "Activo" },
  { id: "row-12", name: "Lima item", code: "C-12", status: "Activo" },
];

const columns: DataTableColumn<CatalogRow>[] = [
  {
    id: "name",
    header: "Nombre",
    accessor: (row) => row.name,
    cell: (row) => <span>{row.name}</span>,
  },
  {
    id: "code",
    header: "Código",
    accessor: (row) => row.code,
  },
  {
    id: "status",
    header: "Estado",
    accessor: (row) => row.status,
  },
  {
    id: "actions",
    header: "Acciones",
    accessor: () => "",
    enableSorting: false,
    headerClassName: "text-right",
    cellClassName: "text-right",
    cell: (row) => <a href={`/catalogo/${row.id}`}>Ver</a>,
  },
];

const renderTable = (
  overrides: Partial<ComponentProps<typeof DataTable<CatalogRow>>> = {},
) =>
  render(
    <DataTable
      columns={columns}
      data={rows}
      emptyTitle="Aún no hay filas"
      getRowAriaLabel={(row) => `Abrir ${row.name}`}
      getRowHref={(row) => `/catalogo/${row.id}`}
      getRowId={(row) => row.id}
      initialPageSize={5}
      pageSizes={[5, 10, 25]}
      resultPlural="resultados"
      resultSingular="resultado"
      searchPlaceholder="Buscar por nombre o código"
      {...overrides}
    />,
  );

const visibleNames = () =>
  screen
    .getAllByRole("link", { name: /^Abrir / })
    .map((row) => row.getAttribute("aria-label")?.replace("Abrir ", "") ?? "");

describe("DataTable", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the Spanish empty state when there are no rows", () => {
    renderTable({ data: [] });

    expect(screen.getByText("Aún no hay filas")).toBeTruthy();
    expect(screen.getByText("0 resultados")).toBeTruthy();
  });

  it("filters rows from the toolbar and shows a no-matches state", () => {
    renderTable();

    const search = screen.getByRole("searchbox", {
      name: "Buscar en la tabla",
    });

    fireEvent.change(search, { target: { value: "Alpha" } });

    expect(screen.getByText("1 de 12 resultados")).toBeTruthy();
    expect(screen.getByText("Alpha item")).toBeTruthy();
    expect(screen.queryByText("Zulu item")).toBeNull();

    fireEvent.change(search, { target: { value: "sin-coincidencias" } });

    expect(screen.getByText("No hay coincidencias")).toBeTruthy();
    expect(
      screen.getByText("Prueba con otros términos o limpia la búsqueda."),
    ).toBeTruthy();
    expect(screen.getByText("0 de 12 resultados")).toBeTruthy();
  });

  it("sorts by column from a keyboard-activable header button", () => {
    renderTable();

    const nameHeader = screen.getByRole("columnheader", { name: /Nombre/ });
    const sortButton = within(nameHeader).getByRole("button");

    fireEvent.click(sortButton);

    expect(nameHeader.getAttribute("aria-sort")).toBe("ascending");
    expect(visibleNames()[0]).toBe("Alpha item");

    fireEvent.click(sortButton);

    expect(nameHeader.getAttribute("aria-sort")).toBe("descending");
    expect(visibleNames()[0]).toBe("Zulu item");
  });

  it("paginates when there are many rows and keeps row actions", () => {
    renderTable();

    expect(screen.getByText("12 resultados")).toBeTruthy();
    expect(screen.getByText("Página 1 de 3")).toBeTruthy();
    expect(screen.getByText("Alpha item")).toBeTruthy();
    expect(screen.queryByText("Foxtrot item")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

    expect(screen.getByText("Página 2 de 3")).toBeTruthy();
    expect(screen.getByText("Foxtrot item")).toBeTruthy();
    expect(screen.queryByText("Alpha item")).toBeNull();

    const actionLink = screen.getAllByRole("link", { name: "Ver" })[0];
    expect(actionLink.getAttribute("href")).toMatch(/^\/catalogo\/row-/);

    fireEvent.change(screen.getByLabelText("Filas por página"), {
      target: { value: "10" },
    });

    expect(screen.getByText("Página 1 de 2")).toBeTruthy();
    expect(screen.getByText("Alpha item")).toBeTruthy();
    expect(screen.getByText("Juliet item")).toBeTruthy();
  });
});
