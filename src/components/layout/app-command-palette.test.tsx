import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, searchPeople } = vi.hoisted(() => ({
  push: vi.fn(),
  searchPeople: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/people/actions", () => ({
  searchPeopleForPaletteAction: searchPeople,
}));

import {
  AppCommandPalette,
  openAppCommandPalette,
} from "@/components/layout/app-command-palette";
import { NAV_GROUPS } from "@/lib/navigation";

afterEach(() => {
  cleanup();
  push.mockReset();
  searchPeople.mockReset();
});

const openPalette = (
  access = {
    canReadMembers: true,
    canUseConnections: true,
    canReadReports: true,
    canReadDocuments: true,
  },
) => {
  render(<AppCommandPalette access={access} />);
  act(() => openAppCommandPalette());
  return screen.getByRole("combobox");
};

const optionLabels = () =>
  screen.getAllByRole("option").map((option) => option.textContent);

describe("AppCommandPalette", () => {
  it("lists every sidebar page from the shared config and the main actions", () => {
    openPalette();

    const labels = optionLabels();
    for (const item of NAV_GROUPS.flatMap((group) => group.items)) {
      expect(labels).toContain(item.title);
    }
    for (const action of [
      "Nueva persona",
      "Importar personas",
      "Nuevo activo",
      "Iniciar alta",
    ]) {
      expect(labels).toContain(action);
    }
    expect(labels).toContain("Resguardo");
    expect(labels).not.toContain("Inventario");
  });

  it("hides Miembros, Conexiones and Rotación without access", () => {
    openPalette({
      canReadMembers: false,
      canUseConnections: false,
      canReadReports: false,
      canReadDocuments: false,
    });

    expect(optionLabels()).not.toContain("Miembros");
    expect(optionLabels()).not.toContain("Conexiones");
    expect(optionLabels()).not.toContain("Rotación");
    expect(optionLabels()).not.toContain("Documentos");
  });

  it("finds people by RFC as you type and opens the expediente", async () => {
    searchPeople.mockResolvedValue([
      {
        id: "p1",
        label: "Sofía Demo Ejemplo",
        detail: "XAXX010101002 · Activa",
      },
    ]);
    const input = openPalette();

    fireEvent.change(input, { target: { value: "XAXX0101" } });

    const person = await screen.findByRole("option", {
      name: /Sofía Demo Ejemplo/,
    });
    expect(searchPeople).toHaveBeenCalledWith("XAXX0101");
    expect(person.textContent).toContain("XAXX010101002");

    fireEvent.click(person);
    expect(push).toHaveBeenCalledWith("/app/personas/p1");
  });

  it("does not search people for a single character", async () => {
    const input = openPalette();

    fireEvent.change(input, { target: { value: "s" } });

    await new Promise((resolve) => setTimeout(resolve, 300));
    await waitFor(() => expect(searchPeople).not.toHaveBeenCalled());
  });
});
