import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { PersonasDataTable } from "@/components/people/personas-data-table";
import { OFFICIAL_DELETED_DEMO_FULL_NAME } from "@/lib/people/borrados-cleanup";

afterEach(() => {
  cleanup();
});

const demoPeople = [
  {
    id: "person-activa",
    name: "Persona Demo",
    rfc: "XAXX010101000",
    status: "activa" as const,
    deleted: false,
    searchText: "Persona Demo XAXX010101000",
  },
  {
    id: "person-borrada",
    name: OFFICIAL_DELETED_DEMO_FULL_NAME,
    rfc: "XAXX010101001",
    status: "activa" as const,
    deleted: true,
    searchText: `${OFFICIAL_DELETED_DEMO_FULL_NAME} XAXX010101001`,
  },
];

describe("PersonasDataTable deleted visibility", () => {
  it("hides soft-deleted people from the default expediente list", () => {
    render(<PersonasDataTable people={demoPeople} />);

    expect(screen.getAllByText("Persona Demo").length).toBeGreaterThan(0);
    expect(screen.queryByText(OFFICIAL_DELETED_DEMO_FULL_NAME)).toBeNull();
  });

  it("opens the borrados list when initialVisibility is deleted", () => {
    render(
      <PersonasDataTable initialVisibility="deleted" people={demoPeople} />,
    );

    expect(
      screen.getAllByText(OFFICIAL_DELETED_DEMO_FULL_NAME).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Persona Demo")).toBeNull();
  });

  it("shows soft-deleted people when the borrados filter is selected", () => {
    render(<PersonasDataTable people={demoPeople} />);

    fireEvent.change(screen.getByLabelText("Expediente"), {
      target: { value: "deleted" },
    });

    expect(
      screen.getAllByText(OFFICIAL_DELETED_DEMO_FULL_NAME).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Borrado").length).toBeGreaterThan(0);
    expect(screen.queryByText("Persona Demo")).toBeNull();
  });
});
