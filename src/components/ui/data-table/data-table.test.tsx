import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { PencilIcon, Trash2Icon } from "lucide-react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { chooseSelectOption } from "@/test/choose-select-option";
import {
  DataTable,
  RowInlineAction,
  RowMenu,
  type DataTableColumn,
} from "@/components/ui/data-table";

type CatalogRow = {
  id: string;
  name: string;
  code: string;
  status: string;
  note: string | null;
};

const names = [
  "Zulu",
  "Alpha",
  "Mike",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
  "India",
  "Juliet",
  "Kilo",
  "Lima",
];

const rows: CatalogRow[] = names.map((name, index) => ({
  id: `row-${String(index + 1).padStart(2, "0")}`,
  name: `${name} item`,
  code: `C-${String(index + 1).padStart(2, "0")}`,
  status: index % 3 === 0 ? "Inactivo" : "Activo",
  note: index === 0 ? null : "nota",
}));

const columns: DataTableColumn<CatalogRow>[] = [
  {
    id: "name",
    header: "Nombre",
    accessor: (row) => row.name,
    variant: "primary",
    truncate: true,
  },
  {
    id: "code",
    header: "Código",
    accessor: (row) => row.code,
    variant: "muted",
  },
  { id: "status", header: "Estado", accessor: (row) => row.status },
  {
    id: "note",
    header: "Nota",
    accessor: (row) => row.note,
    enableSorting: false,
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
      searchPlaceholder="Buscar por nombre o código"
      {...overrides}
    />,
  );

/** The desktop table; the mobile cards render the same rows. */
const table = () => within(screen.getByRole("table"));
const cards = () =>
  screen
    .getAllByRole("listitem")
    .map((item) => item.querySelector("[data-slot=data-table-card]"));

const visibleNames = () =>
  table()
    .getAllByRole("link", { name: /^Abrir / })
    .map((row) => row.getAttribute("aria-label")?.replace("Abrir ", "") ?? "");

describe("DataTable", () => {
  beforeEach(() => {
    push.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the empty state without a footer when there are no rows", () => {
    renderTable({ data: [] });

    expect(screen.getByText("Aún no hay filas")).toBeTruthy();
    expect(screen.queryByText(/ de 0/)).toBeNull();
  });

  it("opens the record when the row is clicked or activated by keyboard", () => {
    renderTable();

    const row = table().getByRole("link", { name: "Abrir Zulu item" });

    fireEvent.click(row);
    expect(push).toHaveBeenLastCalledWith("/catalogo/row-01");

    fireEvent.keyDown(table().getByRole("link", { name: "Abrir Alpha item" }), {
      key: "Enter",
    });
    expect(push).toHaveBeenLastCalledWith("/catalogo/row-02");
  });

  it("filters from the search box and shows a no-matches state", () => {
    renderTable();

    const search = screen.getByRole("searchbox", {
      name: "Buscar en la tabla",
    });

    fireEvent.change(search, { target: { value: "Alpha" } });

    expect(screen.getByText("1–1 de 1")).toBeTruthy();
    expect(visibleNames()).toEqual(["Alpha item"]);

    fireEvent.change(search, { target: { value: "sin-coincidencias" } });

    expect(screen.getByText("No hay coincidencias")).toBeTruthy();
  });

  it("marks only the active sort column and toggles its direction", () => {
    renderTable();

    const nameHeader = table().getByRole("columnheader", { name: /Nombre/ });
    const codeHeader = table().getByRole("columnheader", { name: /Código/ });
    const noteHeader = table().getByRole("columnheader", { name: "Nota" });

    expect(nameHeader.getAttribute("aria-sort")).toBeNull();
    expect(within(noteHeader).queryByRole("button")).toBeNull();

    fireEvent.click(within(nameHeader).getByRole("button"));

    expect(nameHeader.getAttribute("aria-sort")).toBe("ascending");
    expect(codeHeader.getAttribute("aria-sort")).toBeNull();
    expect(visibleNames()[0]).toBe("Alpha item");

    fireEvent.click(within(nameHeader).getByRole("button"));

    expect(nameHeader.getAttribute("aria-sort")).toBe("descending");
    expect(visibleNames()[0]).toBe("Zulu item");
  });

  it("renders names in the primary ink, secondary text muted and empties as a dash", () => {
    renderTable();

    const firstRow = table().getByRole("link", { name: "Abrir Zulu item" });
    const [name, code, , note] = within(firstRow).getAllByRole("cell");

    expect(name.className).toContain("text-foreground");
    expect(name.className).not.toContain("font-medium");
    expect(name.querySelector("[title='Zulu item']")).toBeTruthy();
    expect(code.className).toContain("tabular-nums");
    expect(code.className).toContain("text-muted-foreground");
    expect(note.textContent).toBe("—");
  });

  it("pages from the footer: range, page size and ‹ ›", () => {
    renderTable();

    expect(screen.getByText("1–5 de 12")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Página anterior" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

    expect(screen.getByText("6–10 de 12")).toBeTruthy();
    expect(visibleNames()[0]).toBe("Foxtrot item");

    chooseSelectOption("Filas por página", "10 por página");

    expect(screen.getByText("1–10 de 12")).toBeTruthy();
  });

  it("keeps row actions in the ⋯ menu and the inline icon from opening the row", () => {
    const onEdit = vi.fn();

    renderTable({
      inlineAction: (row) => (
        <RowInlineAction
          icon={PencilIcon}
          label={`Editar ${row.name}`}
          onClick={onEdit}
        />
      ),
      rowMenu: (row) => (
        <RowMenu
          actions={[
            {
              label: "Borrar",
              icon: Trash2Icon,
              destructive: true,
              onSelect: vi.fn(),
              confirm: {
                title: "¿Borrar?",
                description: "No se puede deshacer.",
                confirmLabel: "Borrar",
              },
            },
            { label: "Editar", icon: PencilIcon, href: `/editar/${row.id}` },
          ]}
          label={`Acciones de ${row.name}`}
        />
      ),
    });

    fireEvent.click(table().getByRole("button", { name: "Editar Zulu item" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();

    const trigger = table().getByRole("button", {
      name: "Acciones de Zulu item",
    });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

    const items = screen.getAllByRole("menuitem");

    // The destructive item goes last, whatever the order it was given in.
    expect(items.map((item) => item.textContent)).toEqual(["Editar", "Borrar"]);
    expect(items[1].getAttribute("data-variant")).toBe("destructive");

    fireEvent.click(items[1]);

    expect(screen.getByRole("alertdialog", { name: "¿Borrar?" })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("lets one column take the slack and the other truncating ones shrink", () => {
    renderTable({
      columns: [
        columns[0],
        columns[1],
        { ...columns[2], truncate: true },
        columns[3],
      ],
    });

    const cells = table().getAllByRole("cell").slice(0, 4);

    // Nombre is the first truncating column, so it fills; Estado scales.
    expect(cells[0]).toHaveClass("w-3/5", "max-w-0", "min-w-32");
    expect(cells[1]).not.toHaveClass("max-w-0");
    expect(cells[2]).toHaveClass("w-1/5", "max-w-0", "min-w-28");
    expect(cells[2]).not.toHaveClass("w-3/5");
    expect(within(cells[0]).getByText("Zulu item")).toHaveClass("truncate");

    const headers = table().getAllByRole("columnheader");
    expect(headers[0]).toHaveClass("w-3/5");
    expect(headers[2]).toHaveClass("w-1/5");

    // jsdom has no layout, so this only guards against a cell that scrolls;
    // the classes are what keep a real browser from scrolling the table.
    for (const cell of table().getAllByRole("cell")) {
      expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth);
    }
  });

  it("fills the column marked fill instead of the first truncating one", () => {
    renderTable({
      columns: [
        columns[0],
        { ...columns[1], fill: true },
        columns[2],
        columns[3],
      ],
    });

    const cells = table().getAllByRole("cell").slice(0, 4);

    expect(cells[0]).toHaveClass("w-1/5", "max-w-0");
    expect(cells[0]).not.toHaveClass("w-3/5");
    expect(cells[1]).toHaveClass("w-3/5", "max-w-0", "min-w-32");
  });

  it("renders the same rows as cards with title, subtitle and badge", () => {
    renderTable({
      mobileCard: (row) => ({
        title: row.name,
        subtitle: row.code,
        badge: <span data-testid="badge">{row.status}</span>,
      }),
      rowMenu: (row) => (
        <RowMenu
          actions={[{ label: "Editar", icon: PencilIcon, href: "/x" }]}
          label={`Acciones de ${row.name}`}
        />
      ),
    });

    const [first] = cards();

    expect(cards()).toHaveLength(5);
    expect(first?.textContent).toContain("Zulu item");
    expect(first?.textContent).toContain("C-01");
    expect(within(first as HTMLElement).getByTestId("badge")).toBeTruthy();
    expect(
      within(first as HTMLElement).getByRole("button", {
        name: "Acciones de Zulu item",
      }),
    ).toBeTruthy();

    fireEvent.click(first as HTMLElement);
    expect(push).toHaveBeenLastCalledWith("/catalogo/row-01");
  });
});

describe("DataTable server mode", () => {
  afterEach(() => {
    cleanup();
  });

  const server = {
    total: 60,
    page: 2,
    pageSize: 25,
    query: "",
    hasFilters: false,
    onQueryChange: vi.fn(),
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
  };

  it("shows the server range and delegates paging", () => {
    renderTable({ data: rows.slice(0, 3), server });

    expect(screen.getByText("26–28 de 60")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));

    expect(server.onPageChange).toHaveBeenNthCalledWith(1, 3);
    expect(server.onPageChange).toHaveBeenNthCalledWith(2, 1);
  });

  it("does not offer client sorting, which would only reorder one page", () => {
    renderTable({ data: rows.slice(0, 3), server });

    expect(screen.queryByRole("button", { name: /Ordenar por/ })).toBeNull();
  });

  it("hides the search box when the page filters on its own", () => {
    renderTable({
      data: rows.slice(0, 3),
      server: { ...server, onQueryChange: undefined },
    });

    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
