import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/app/personas",
  useSearchParams: () => new URLSearchParams("q=demo&page=2"),
}));

import { PersonasDataTable } from "@/components/people/personas-data-table";
import { OFFICIAL_DELETED_DEMO_FULL_NAME } from "@/lib/people/borrados-cleanup";

afterEach(() => {
  cleanup();
  replace.mockClear();
});

const demoPeople = [
  {
    id: "person-activa",
    name: "Persona Demo",
    rfc: "XAXX010101000",
    fechaIngreso: "2026-03-15",
    status: "activa" as const,
    deleted: false,
  },
];

const baseProps = {
  page: 2,
  pageSize: 25,
  query: "demo",
  status: "" as const,
  total: 30,
  visibility: "expediente" as const,
};

describe("PersonasDataTable (server paged)", () => {
  it("renders the rows it is given and the server total", () => {
    render(<PersonasDataTable {...baseProps} people={demoPeople} />);

    expect(screen.getAllByText("Persona Demo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("15/03/2026").length).toBeGreaterThan(0);
    expect(screen.queryByText("03/15/2026")).toBeNull();
    expect(screen.getByText(/30/)).toBeTruthy();
  });

  it("shows the borrados rows when the server sends them", () => {
    render(
      <PersonasDataTable
        {...baseProps}
        people={[
          {
            id: "person-borrada",
            name: OFFICIAL_DELETED_DEMO_FULL_NAME,
            rfc: null,
            fechaIngreso: null,
            status: "activa",
            deleted: true,
          },
        ]}
        visibility="deleted"
      />,
    );

    expect(
      screen.getAllByText(OFFICIAL_DELETED_DEMO_FULL_NAME).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Borrado").length).toBeGreaterThan(0);
  });

  it("asks the server for borrados through the URL and resets the page", () => {
    render(<PersonasDataTable {...baseProps} people={demoPeople} />);

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
      <PersonasDataTable {...baseProps} people={demoPeople} status="baja" />,
    );

    expect(
      screen.getByRole("button", { name: "Relación: Bajas" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Filtrar$/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(String(replace.mock.calls[0][0])).toBe("/app/personas");
  });

  it("removes one filter with the chip's ✕", () => {
    render(
      <PersonasDataTable {...baseProps} people={demoPeople} status="baja" />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Quitar filtro Relación" }),
    );

    const url = String(replace.mock.calls[0][0]);
    expect(url).not.toContain("status=");
    expect(url).toContain("q=demo");
  });
});
