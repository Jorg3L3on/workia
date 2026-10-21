import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  usePathname: () => "/app/personas",
  useSearchParams: () => new URLSearchParams("q=demo&page=2"),
}));

// Server actions: the table only calls them when a popover or the sheet opens.
vi.mock("@/lib/people/filter/actions", () => ({
  countPeopleFilterAction: vi.fn(async () => 1),
  countPeopleFilterOptionsAction: vi.fn(async () => ({ baja: 3, activa: 9 })),
}));
vi.mock("@/lib/people/views/actions", () => ({
  createPeopleViewAction: vi.fn(),
  updatePeopleViewAction: vi.fn(),
  deletePeopleViewAction: vi.fn(),
}));
vi.mock("@/lib/people/actions", () => ({
  searchManagerOptionsAction: vi.fn(async () => []),
}));

import { PersonasDataTable } from "@/components/people/personas-data-table";
import { allowedPeopleColumns } from "@/lib/people/filter/columns";
import { allowedPeopleFilterFields } from "@/lib/people/filter/fields";
import {
  coercePeopleFilter,
  type PeopleFilter,
} from "@/lib/people/filter/schema";
import { OFFICIAL_DELETED_DEMO_FULL_NAME } from "@/lib/people/borrados-cleanup";

afterEach(() => {
  cleanup();
  replace.mockClear();
});

const demoPeople = [
  {
    id: "person-activa",
    name: "Persona Demo",
    status: "activa" as const,
    deleted: false,
    cells: { rfc: "XAXX010101000", ingreso: "2026-03-15" },
  },
];

const permissions = new Set<string>();

const props = (filter: Partial<PeopleFilter> = {}) => ({
  page: 2,
  pageSize: 25,
  total: 30,
  filter: coercePeopleFilter({ q: "demo", ...filter }),
  fields: allowedPeopleFilterFields(permissions),
  options: {},
  today: "2026-10-21",
  columns: ["rfc" as const, "ingreso" as const, "relacion" as const],
  allowedColumns: allowedPeopleColumns(permissions),
  canExport: true,
});

describe("PersonasDataTable (server paged)", () => {
  it("renders the rows it is given and the server total", () => {
    render(<PersonasDataTable {...props()} people={demoPeople} />);

    expect(screen.getAllByText("Persona Demo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("15/03/2026").length).toBeGreaterThan(0);
    expect(screen.queryByText("03/15/2026")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Exportar \(30\)/ }),
    ).toBeTruthy();
  });

  it("shows the borrados rows when the server sends them", () => {
    render(
      <PersonasDataTable
        {...props({ deleted: true })}
        people={[
          {
            id: "person-borrada",
            name: OFFICIAL_DELETED_DEMO_FULL_NAME,
            status: "activa",
            deleted: true,
            cells: {},
          },
        ]}
      />,
    );

    expect(
      screen.getAllByText(OFFICIAL_DELETED_DEMO_FULL_NAME).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Borrado").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Expediente: Borrados" }),
    ).toBeTruthy();
  });

  it("asks the server for borrados through the URL and resets the page", () => {
    render(<PersonasDataTable {...props()} people={demoPeople} />);

    fireEvent.click(screen.getByRole("button", { name: "Expediente" }));
    fireEvent.click(screen.getByRole("option", { name: "Borrados" }));

    expect(replace).toHaveBeenCalledTimes(1);
    const url = String(replace.mock.calls[0][0]);
    expect(url).toContain("deleted=1");
    expect(url).toContain("q=demo");
    expect(url).not.toContain("page=");
  });

  it("shows the active filter on its chip and clears everything in one URL update", () => {
    render(
      <PersonasDataTable
        {...props({
          conditions: [{ field: "relacion", op: "is", values: ["baja"] }],
        })}
        people={demoPeople}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Relación: Bajas" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(String(replace.mock.calls[0][0])).toBe("/app/personas");
  });

  it("removes one filter with the chip's ✕", () => {
    render(
      <PersonasDataTable
        {...props({
          conditions: [{ field: "relacion", op: "is", values: ["baja"] }],
        })}
        people={demoPeople}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Quitar filtro Relación" }),
    );

    const url = String(replace.mock.calls[0][0]);
    expect(url).not.toContain("f=");
    expect(url).toContain("q=demo");
  });

  it("writes a picked option as the compact filter parameter", async () => {
    render(<PersonasDataTable {...props()} people={demoPeople} />);

    fireEvent.click(screen.getByRole("button", { name: "Relación" }));
    fireEvent.click(await screen.findByRole("option", { name: /Bajas/ }));

    const url = new URL(String(replace.mock.calls[0][0]), "http://test");
    expect(url.searchParams.get("f")).toBe("1*st.i.baja");
    expect(url.searchParams.get("q")).toBe("demo");
  });

  it("exports the same filter and the visible columns", () => {
    render(
      <PersonasDataTable
        {...props({
          conditions: [{ field: "relacion", op: "is", values: ["baja"] }],
        })}
        people={demoPeople}
      />,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: /Exportar \(30\)/ }),
      { button: 0, ctrlKey: false },
    );
    const csv = screen.getByRole("menuitem", { name: "CSV" });
    const href = new URL(csv.getAttribute("href")!, "http://test");

    expect(href.pathname).toBe("/app/personas/exportar");
    expect(href.searchParams.get("q")).toBe("demo");
    expect(href.searchParams.get("f")).toBe("1*st.i.baja");
    expect(href.searchParams.get("cols")).toBe("rfc.ingreso.relacion");
    expect(href.searchParams.get("format")).toBe("csv");
  });
});
