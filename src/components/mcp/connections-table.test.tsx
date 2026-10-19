import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/mcp/connection-row-actions", () => ({
  ConnectionRowActions: () => <button type="button">Revocar</button>,
}));

import { ConnectionsTable } from "@/components/mcp/connections-table";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ConnectionListItem } from "@/lib/mcp/connections";

const now = new Date("2026-10-18T12:00:00Z");

const buildConnection = (
  overrides: Partial<ConnectionListItem> = {},
): ConnectionListItem => ({
  id: "connection-01",
  userId: "user-01",
  kind: "pat",
  name: "Grok QA",
  clientName: "",
  isChatgpt: false,
  scopes: [
    "read",
    "audit",
    "write:assets",
    "write:people",
    "write:contracts",
    "write:catalog",
  ],
  tokenPrefix: "workia_pat_iU5yc4Y3",
  tokenExpiresAt: new Date("2026-10-24T12:00:00Z"),
  refreshExpiresAt: null,
  lastUsedAt: new Date("2026-10-17T22:45:00Z"),
  revokedAt: null,
  revokedReason: null,
  createdAt: new Date("2026-10-01T12:00:00Z"),
  userName: "System Admin",
  userEmail: "admin@workia.local",
  ...overrides,
});

const renderTable = (connections: ConnectionListItem[]) =>
  render(
    <TooltipProvider>
      <ConnectionsTable
        connections={connections}
        now={now}
        showAll={false}
        userId="user-01"
        canCreate
        canManage
      />
    </TooltipProvider>,
  );

/** The Permisos cell of a row (third column without «Persona»). */
const permisosCell = (row: HTMLElement) =>
  within(row).getAllByRole("cell")[1] as HTMLElement;

describe("ConnectionsTable", () => {
  afterEach(() => cleanup());

  it("shows six permissions as the first chip plus «+5», never the raw list", () => {
    renderTable([buildConnection()]);

    const row = screen.getByTestId("connection-row");
    const cell = permisosCell(row);

    expect(within(cell).getByText("Leer")).toBeInTheDocument();
    const more = within(cell).getByTestId("connection-scopes-more");
    expect(more).toHaveTextContent("+5");
    expect(more).toHaveAccessibleName(
      "5 permisos más: Auditoría, Escribir resguardo, Escribir personas, Escribir contratos, Escribir catálogo",
    );
    // The long comma list is what overflowed into Vence, Último uso and Estado.
    expect(cell).not.toHaveTextContent("Auditoría");
    expect(cell).not.toHaveTextContent(",");
  });

  it("keeps every cell within its column", () => {
    renderTable([buildConnection()]);

    const cells = within(screen.getByTestId("connection-row")).getAllByRole(
      "cell",
    );

    for (const cell of cells) {
      expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth);
    }
    // jsdom has no layout, so the widths above only guard against a cell that
    // scrolls; the classes are what keep a real browser from overflowing.
    expect(cells[0]).toHaveClass("max-w-0", "w-full");
    expect(cells[1]).toHaveClass("min-w-0", "max-w-56");
    expect(within(cells[1]).getByText("Leer")).toHaveClass("truncate");
  });

  it("shows a single permission without a «+N» chip", () => {
    renderTable([buildConnection({ scopes: ["read", "offline_access"] })]);

    const cell = permisosCell(screen.getByTestId("connection-row"));

    expect(cell).toHaveTextContent("Leer");
    expect(
      within(cell).queryByTestId("connection-scopes-more"),
    ).not.toBeInTheDocument();
  });
});
