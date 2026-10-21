import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/people/actions", () => ({
  createPersonAction: vi.fn(),
  updatePersonAction: vi.fn(),
  searchManagerOptionsAction: vi.fn().mockResolvedValue([]),
}));

import { PersonForm } from "@/components/people/person-form";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderCreate = () =>
  render(<PersonForm areas={[]} mode="create" positions={[]} sites={[]} />);

const labelTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("label")).map((label) =>
    (label.textContent ?? "").trim(),
  );

describe("PersonForm", () => {
  it("lists the six sections in the nav, one card each", () => {
    const { container } = renderCreate();
    const nav = screen.getByRole("navigation", {
      name: "Secciones del formulario",
    });

    expect(
      Array.from(nav.querySelectorAll("a")).map((link) => link.textContent),
    ).toEqual([
      "Nombre",
      "Empresa",
      "Horario",
      "Identificadores",
      "Datos México",
      "Beneficiarios",
    ]);
    expect(container.querySelectorAll("section[data-section]")).toHaveLength(6);

    // jsdom has no layout; the scroll highlight is covered by the e2e.
    window.HTMLElement.prototype.scrollBy = vi.fn();
    fireEvent.click(screen.getByRole("link", { name: "Datos México" }));
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe(
      "Datos México",
    );
  });

  it("marks every optional field and leaves the required ones unmarked", () => {
    const { container } = renderCreate();
    const required = ["Nombre(s)", "Apellido paterno"];
    const labels = labelTexts(container).filter(
      (text) => !required.includes(text),
    );

    expect(labelTexts(container)).toEqual(expect.arrayContaining(required));
    for (const text of ["Calle", "Colonia", "Estado civil", "Estado"]) {
      expect(labels).toContain(`${text} (opcional)`);
    }
    expect(labels.filter((text) => !text.endsWith("(opcional)"))).toEqual([]);
  });

  it("has no Relación laboral field", () => {
    const { container } = renderCreate();

    expect(screen.queryByText("Relación laboral")).toBeNull();
    expect(container.querySelector('[name="status"]')).toBeNull();
  });

  it("counts the required fields still empty in the sticky footer", () => {
    renderCreate();
    const pending = screen.getByTestId("pendientes-obligatorios");

    expect(pending.textContent).toBe("2 campos obligatorios pendientes");

    fireEvent.input(screen.getByLabelText("Nombre(s)"), {
      target: { value: "Ana" },
    });
    expect(pending.textContent).toBe("1 campo obligatorio pendiente");

    fireEvent.input(screen.getByLabelText("Apellido paterno"), {
      target: { value: "Demo" },
    });
    expect(pending.textContent).toBe("Campos obligatorios completos");
    expect(
      screen.getByRole("button", { name: "Guardar persona" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Cancelar" })).toBeTruthy();
  });

  it("keeps Agregar bloque and Día de descanso inside the Horario card", () => {
    renderCreate();
    const editor = screen.getByTestId("schedule-blocks-editor");

    expect(
      editor.querySelector("button")?.textContent?.includes("Agregar bloque"),
    ).toBe(true);
    expect(editor.textContent).toContain("Día de descanso (opcional)");
    expect(editor.textContent).toContain("Sin horario capturado.");
    expect(editor.textContent).not.toContain("—");
  });

  it("opens at the section and field a card's «Editar» names", () => {
    // Outside the shell there is no inner scroller: the window scrolls.
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    render(
      <PersonForm
        areas={[]}
        initialField="curp"
        initialSection="identificadores"
        mode="create"
        positions={[]}
        sites={[]}
      />,
    );

    expect(scrollBy).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "auto" }),
    );
    expect(document.activeElement?.id).toBe("curp");
    expect(
      screen
        .getByRole("navigation", { name: "Secciones del formulario" })
        .querySelector('[aria-current="location"]')?.textContent,
    ).toBe("Identificadores");
  });

  it("focuses the section's first control when the field is elsewhere", () => {
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    render(
      <PersonForm
        areas={[]}
        initialField="curp"
        initialSection="nombre"
        mode="create"
        positions={[]}
        sites={[]}
      />,
    );

    expect(document.activeElement?.id).toBe("nombres");
  });
});
