import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompanyProvider } from "@/components/tenant/company-context";
import {
  PositionDocumentsSection,
  type PositionDocumentRequirement,
} from "@/components/catalog/position-documents-section";

const { refresh, setRequirementsAction } = vi.hoisted(() => ({
  refresh: vi.fn(),
  setRequirementsAction: vi.fn<
    (formData: FormData) => Promise<{ ok: true } | { error: string }>
  >(async () => ({ ok: true })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

vi.mock("@/lib/documents/actions", () => ({
  setRequirementsAction,
}));

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

const renderSection = (
  requirements: PositionDocumentRequirement[],
  companyId?: string,
) => {
  const section = (
    <PositionDocumentsSection
      canManage
      positionId="00000000-0000-4000-8000-000000000010"
      requirements={requirements}
    />
  );

  return render(
    companyId ? (
      <CompanyProvider company={{ id: companyId, name: "Empresa demo" }}>
        {section}
      </CompanyProvider>
    ) : (
      section
    ),
  );
};

const payloadOf = () =>
  JSON.parse(
    String(setRequirementsAction.mock.calls.at(-1)?.[0].get("payload")),
  );

describe("PositionDocumentsSection", () => {
  afterEach(() => {
    cleanup();
    setRequirementsAction.mockReset();
    setRequirementsAction.mockResolvedValue({ ok: true });
    refresh.mockClear();
  });

  it("rejects an empty name and does not save", () => {
    renderSection([paper("d1", "Identificación")]);

    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar documentos" }));

    expect(screen.getByRole("alert").textContent).toBe(
      "El nombre es obligatorio",
    );
    expect(setRequirementsAction).not.toHaveBeenCalled();
  });

  it("rejects duplicate names and a vigencia that is missing or out of range", () => {
    renderSection([
      paper("d1", "Identificación"),
      paper("d2", "Domicilio", { sort: 1 }),
    ]);

    const names = screen.getAllByLabelText("Nombre");
    fireEvent.change(names[1], { target: { value: "identificación" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar documentos" }));

    expect(screen.getByRole("alert").textContent).toBe(
      "Hay nombres repetidos.",
    );
    expect(setRequirementsAction).not.toHaveBeenCalled();

    fireEvent.change(names[1], { target: { value: "Domicilio" } });
    fireEvent.click(screen.getAllByRole("switch", { name: "No vence" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Guardar documentos" }));

    expect(screen.getByRole("alert").textContent).toBe(
      "Indica los meses de vigencia o marca «No vence».",
    );

    fireEvent.change(screen.getAllByLabelText("Vigencia (meses)")[0], {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar documentos" }));

    expect(screen.getByRole("alert").textContent).toBe(
      "La vigencia va de 1 a 120 meses.",
    );
    expect(setRequirementsAction).not.toHaveBeenCalled();
  });

  it("saves name, required, validity and order, and shows Guardando…", async () => {
    let resolveSave: (value: { ok: true }) => void = () => undefined;
    setRequirementsAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    renderSection(
      [
        paper("d1", "Identificación"),
        paper("d2", "Domicilio", { sort: 1, required: false }),
      ],
      "00000000-0000-4000-8000-000000000099",
    );

    expect(screen.getAllByLabelText("Vigencia (meses)")[1]).toHaveValue("");

    fireEvent.click(
      screen.getByRole("button", { name: "Bajar Identificación" }),
    );
    fireEvent.click(screen.getAllByRole("switch", { name: "No vence" })[1]);
    fireEvent.change(screen.getAllByLabelText("Vigencia (meses)")[1], {
      target: { value: "12" },
    });
    fireEvent.click(screen.getAllByRole("switch", { name: "Activo" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Guardar documentos" }));

    expect(
      await screen.findByRole("button", { name: "Guardando…" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("form", { name: "Documentos requeridos" }),
    ).toHaveAttribute("aria-busy", "true");

    resolveSave({ ok: true });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Documentos guardados.",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setRequirementsAction.mock.calls[0][0].get("companyId")).toBe(
      "00000000-0000-4000-8000-000000000099",
    );
    expect([...setRequirementsAction.mock.calls[0][0].keys()].sort()).toEqual([
      "companyId",
      "payload",
    ]);
    expect(payloadOf()).toEqual({
      positionId: "00000000-0000-4000-8000-000000000010",
      requirements: [
        {
          id: "d2",
          name: "Domicilio",
          required: false,
          validityMonths: null,
          sort: 0,
          active: true,
        },
        {
          id: "d1",
          name: "Identificación",
          required: true,
          validityMonths: 12,
          sort: 1,
          active: false,
        },
      ],
    });
  });

  it("shows the action error and drops an unsaved row", async () => {
    setRequirementsAction.mockResolvedValue({
      error: "Ya existe un requisito activo con ese nombre.",
    });
    renderSection([paper("d1", "Identificación")]);

    fireEvent.click(screen.getByRole("button", { name: "Agregar documento" }));
    const names = screen.getAllByLabelText("Nombre");
    fireEvent.change(names[1], { target: { value: "Gafete" } });
    fireEvent.click(screen.getByRole("button", { name: "Quitar Gafete" }));
    expect(screen.getAllByLabelText("Nombre")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Quitar Identificación" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Guardar documentos" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Ya existe un requisito activo con ese nombre.",
    );
  });
});
