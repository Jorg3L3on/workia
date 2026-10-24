import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { lazy, type ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { RowMenu, type RowMenuAction } from "@/components/ui/data-table";

afterEach(() => {
  cleanup();
});

/** Radix menus open on pointerdown in jsdom. */
const openMenu = () => {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Más acciones" }), {
    button: 0,
    ctrlKey: false,
  });
};

describe("RowMenu", () => {
  it("renders an icon wrapped in React.lazy", async () => {
    // Production Flight hands the client a lazy object that resolves to the
    // element a server component already built. React.lazy is that shape:
    // `isValidElement` is false, and `<Icon />` throws error #306.
    const icon = lazy(() =>
      Promise.resolve({
        default: (<svg data-testid="lazy-icon" />) as unknown as ComponentType,
      }),
    ) as unknown as RowMenuAction["icon"];

    render(
      <RowMenu
        actions={[
          { label: "Descargar", icon, href: "/a" },
          { label: "Historial", icon, href: "/b" },
          { label: "Importar", icon, href: "/c" },
          { label: "Exportar", icon, href: "/d" },
        ]}
        label="Más acciones"
      />,
    );

    openMenu();

    expect(await screen.findAllByTestId("lazy-icon")).toHaveLength(4);
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Descargar", "Historial", "Importar", "Exportar"]);
  });
});
