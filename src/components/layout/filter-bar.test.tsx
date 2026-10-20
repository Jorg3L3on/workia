import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilterBar } from "@/components/layout/filter-bar";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const statusFilter = (value: string, onChange = vi.fn()) => ({
  id: "status",
  label: "Estado",
  value,
  onChange,
  options: [
    { value: "", label: "Todos" },
    { value: "asignado", label: "Asignado" },
    { value: "baja", label: "Baja" },
  ],
});

describe("FilterBar", () => {
  it("applies a chip on change, with no «Filtrar» button", () => {
    const onChange = vi.fn();
    render(<FilterBar filters={[statusFilter("", onChange)]} />);

    expect(screen.queryByRole("button", { name: "Filtrar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Estado" }));
    // The "all" option is the chip's ✕, not a row of the list.
    expect(screen.queryByRole("option", { name: "Todos" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Asignado" }));

    expect(onChange).toHaveBeenCalledWith("asignado");
  });

  it("shows the active value with ✕ and a «Limpiar» link", () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(
      <FilterBar
        filters={[statusFilter("baja", onChange)]}
        onClear={onClear}
      />,
    );

    expect(screen.getByRole("button", { name: "Estado: Baja" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Quitar filtro Estado" }),
    );
    expect(onChange).toHaveBeenCalledWith("");

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("hides «Limpiar» while nothing is filtered", () => {
    render(<FilterBar filters={[statusFilter("")]} onClear={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Limpiar" })).toBeNull();
  });

  it("debounces the search before it reaches the server", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <FilterBar
        search={{ value: "", onChange, placeholder: "Buscar activos" }}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "laptop" },
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onChange).toHaveBeenCalledWith("laptop");
  });

  it("sets a date range from a preset and keeps «ID de recurso» in Avanzado", () => {
    const onRange = vi.fn();
    render(
      <FilterBar
        advanced={[
          {
            id: "resourceId",
            label: "ID de recurso",
            value: "",
            onChange: vi.fn(),
          },
        ]}
        dateRange={{ from: "", to: "", onChange: onRange }}
      />,
    );

    expect(screen.queryByLabelText("ID de recurso")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechas" }));
    fireEvent.click(screen.getByRole("button", { name: "Últimos 7 días" }));
    expect(onRange).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );

    fireEvent.click(screen.getByTestId("filter-advanced"));
    expect(screen.getByLabelText("ID de recurso")).toBeTruthy();
  });

  it("folds the chips into «Filtros · N» for phones", () => {
    render(
      <FilterBar
        dateRange={{ from: "2026-10-01", to: "2026-10-18", onChange: vi.fn() }}
        filters={[statusFilter("baja")]}
      />,
    );

    const sheetButton = screen.getByRole("button", { name: "Filtros · 2" });
    expect(sheetButton.className).toContain("md:hidden");

    fireEvent.click(sheetButton);
    expect(screen.getByRole("dialog", { name: "Filtros" })).toBeTruthy();
  });
});
