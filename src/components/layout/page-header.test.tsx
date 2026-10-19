import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DownloadIcon,
  HistoryIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";

afterEach(() => {
  cleanup();
});

/** Radix menus open on pointerdown in jsdom. */
const openMenu = (name = "Más acciones") => {
  const trigger = screen.getByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
};

describe("PageHeader", () => {
  it("shows one primary, one secondary and the rest in ⋯", () => {
    render(
      <PageHeader
        description="Expedientes, relación laboral e identificadores."
        menu={[
          {
            label: "Exportar a Excel",
            icon: DownloadIcon,
            href: "/app/personas/exportar",
            download: true,
          },
          {
            label: "Historial de importaciones",
            icon: HistoryIcon,
            href: "/app/personas/importaciones",
          },
        ]}
        primary={{
          label: "Nueva persona",
          icon: PlusIcon,
          href: "/app/personas/nueva",
        }}
        secondary={{
          label: "Importar",
          icon: UploadIcon,
          href: "/app/personas/importar",
        }}
        title="Personas"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Personas" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Nueva persona" })).toHaveAttribute(
      "href",
      "/app/personas/nueva",
    );
    // Below 768px the secondary hides; the ⋯ menu repeats it.
    expect(screen.getByRole("link", { name: "Importar" }).className).toContain(
      "hidden md:inline-flex",
    );
    expect(screen.getAllByRole("link")).toHaveLength(2);

    openMenu();

    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Importar",
      "Exportar a Excel",
      "Historial de importaciones",
    ]);
    expect(items[0].className).toContain("md:hidden");
    expect(items[1]).toHaveAttribute("download");
  });

  it("puts the destructive item last, behind a confirmation", () => {
    render(
      <PageHeader
        menu={[
          {
            label: "Eliminar plantilla",
            icon: Trash2Icon,
            destructive: true,
            action: async () => {},
            confirm: {
              title: "Eliminar «Contrato»",
              description: "No se puede deshacer.",
              confirmLabel: "Eliminar plantilla",
            },
          },
          {
            label: "Ver expediente",
            icon: HistoryIcon,
            href: "/app/personas/1",
          },
        ]}
        title="Contrato"
        variant="detail"
      />,
    );

    openMenu();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Ver expediente",
      "Eliminar plantilla",
    ]);
    expect(items[1]).toHaveAttribute("data-variant", "destructive");

    fireEvent.click(items[1]);
    expect(
      screen.getByRole("alertdialog", { name: "Eliminar «Contrato»" }),
    ).toBeTruthy();
  });

  it("shows status and meta on details and submits a form from the primary", () => {
    render(
      <>
        <PageHeader
          meta="Auxiliar ejecutivo · Dirección · Corporativo Demo · ingresó 04/06/2026"
          primary={{ label: "Guardar cambios", form: "company-form" }}
          status={<Badge tone="success">Activa</Badge>}
          title="Empresa Demo"
          variant="detail"
        />
        <form id="company-form" />
      </>,
    );

    expect(screen.getByText("Activa")).toBeTruthy();
    expect(
      screen.getByText(
        "Auxiliar ejecutivo · Dirección · Corporativo Demo · ingresó 04/06/2026",
      ),
    ).toBeTruthy();
    const save = screen.getByRole("button", { name: "Guardar cambios" });
    expect(save).toHaveAttribute("type", "submit");
    expect(save).toHaveAttribute("form", "company-form");
    // On phones the detail primary spans the width.
    expect(save.className).toContain("flex-1");
    expect(screen.queryByRole("button", { name: "Más acciones" })).toBeNull();
  });
});
