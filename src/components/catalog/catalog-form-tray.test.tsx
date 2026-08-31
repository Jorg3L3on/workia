import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CatalogFormTray } from "@/components/catalog/catalog-form-tray";

afterEach(() => {
  cleanup();
});

const renderTray = () =>
  render(
    <CatalogFormTray
      actions={[
        {
          id: "create",
          actionLabel: "Nuevo puesto",
          formTitle: "Nuevo puesto",
          children: (
            <label htmlFor="position-name">
              Nombre
              <input id="position-name" name="name" />
            </label>
          ),
        },
        {
          id: "assign",
          actionLabel: "Asignar actividad",
          formTitle: "Asignar actividad",
          children: (
            <label htmlFor="assign-position">
              Puesto a asignar
              <select id="assign-position" name="positionId">
                <option value="puesto-demo">Puesto demo</option>
              </select>
            </label>
          ),
        },
      ]}
    />,
  );

describe("CatalogFormTray", () => {
  it("keeps create and assign forms collapsed by default", () => {
    renderTray();

    expect(
      screen.getByRole("button", { name: "Nuevo puesto" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByRole("button", { name: "Asignar actividad" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(screen.queryByLabelText("Puesto a asignar")).toBeNull();
  });

  it("opens only the chosen form when the create or assign action is selected", () => {
    renderTray();

    fireEvent.click(screen.getByRole("button", { name: "Nuevo puesto" }));

    expect(screen.getByLabelText("Nombre")).toBeTruthy();
    expect(screen.queryByLabelText("Puesto a asignar")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Nuevo puesto" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Asignar actividad" }),
    ).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Asignar actividad" }));

    expect(screen.getByLabelText("Puesto a asignar")).toBeTruthy();
    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Asignar actividad" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("button", { name: "Nuevo puesto" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the open form from the tray", () => {
    renderTray();

    fireEvent.click(screen.getByRole("button", { name: "Nuevo puesto" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Cerrar formulario de nuevo puesto",
      }),
    );

    expect(screen.queryByLabelText("Nombre")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Nuevo puesto" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
