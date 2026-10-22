import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type MockAction = { label: string; onSelect?: () => void } | false | undefined;
type MockDialogProps = { open: boolean; personName: string };

vi.mock("@/components/ui/data-table", () => ({
  RowMenu: ({ actions }: { actions: MockAction[] }) => (
    <div>
      {actions.map((action) =>
        action && action.onSelect ? (
          <button key={action.label} onClick={action.onSelect} type="button">
            {action.label}
          </button>
        ) : null,
      )}
    </div>
  ),
}));

vi.mock("@/components/people/termination-dialog", () => ({
  TerminationDialog: ({ open }: MockDialogProps) =>
    open ? <div role="dialog">Dar de baja</div> : null,
}));

vi.mock("@/components/people/rehire-dialog", () => ({
  RehireDialog: ({ open }: MockDialogProps) =>
    open ? <div role="dialog">Reingresar</div> : null,
}));

vi.mock("@/components/people/finiquito-dialog", () => ({
  FiniquitoDialog: ({ open }: MockDialogProps) =>
    open ? <div role="dialog">Finiquito</div> : null,
}));

import {
  PersonActionsMenu,
  type PersonEmploymentMenuData,
} from "@/components/people/person-actions-menu";

const action = vi.fn(async () => ({}));

const employment = (
  lastBaja: PersonEmploymentMenuData["lastBaja"],
): PersonEmploymentMenuData => ({
  reasons: [{ id: "r1", name: "Cambio de residencia" }],
  fechaIngreso: "2025-01-15",
  lastBaja,
  canSeeCompensation: true,
});

const closedBaja = {
  fechaBaja: "2026-10-21",
  recontratable: true,
  finiquitoEstado: null,
  finiquitoFecha: null,
  finiquitoMonto: null,
  hasFiniquitoMonto: false,
};

describe("PersonActionsMenu", () => {
  afterEach(() => {
    cleanup();
  });

  it("closes the baja dialog when the saved baja comes back, instead of opening «Reingresar»", () => {
    const { rerender } = render(
      <PersonActionsMenu
        employment={employment(null)}
        finiquitoAction={action}
        personId="p1"
        personName="Persona Demo"
        showConstancia={false}
        status="activa"
        statusAction={action}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dar de baja" }));
    expect(screen.getByRole("dialog").textContent).toBe("Dar de baja");

    rerender(
      <PersonActionsMenu
        employment={employment(closedBaja)}
        finiquitoAction={action}
        personId="p1"
        personName="Persona Demo"
        showConstancia={false}
        status="baja"
        statusAction={action}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reingresar" }));
    expect(screen.getByRole("dialog").textContent).toBe("Reingresar");
  });

  it("closes the finiquito dialog when the saved finiquito comes back", () => {
    const props = {
      finiquitoAction: action,
      personId: "p1",
      personName: "Persona Demo",
      showConstancia: false,
      status: "baja" as const,
      statusAction: action,
    };
    const { rerender } = render(
      <PersonActionsMenu {...props} employment={employment(closedBaja)} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Finiquito" }));
    expect(screen.getByRole("dialog").textContent).toBe("Finiquito");

    rerender(
      <PersonActionsMenu
        {...props}
        employment={employment({
          ...closedBaja,
          finiquitoEstado: "pendiente",
          finiquitoMonto: "12345.67",
          hasFiniquitoMonto: true,
        })}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
