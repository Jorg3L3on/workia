import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/catalog/actions", () => ({
  assignActivityToPositionAction: async () => undefined,
}));

import { PositionActivitiesAssign } from "@/components/catalog/position-activities-assign";

afterEach(() => {
  cleanup();
});

describe("PositionActivitiesAssign", () => {
  it("renders labeled assign fields for dummy catalog data", () => {
    render(
      <PositionActivitiesAssign
        activities={[{ id: "activity-demo", name: "Actividad dummy" }]}
        positions={[
          {
            id: "position-demo",
            name: "Puesto demo",
            assignedActivityIds: [],
          },
        ]}
      />,
    );

    expect(screen.getByLabelText("Puesto a asignar")).toBeTruthy();
    expect(screen.getByLabelText("Actividad a asignar")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Asignar actividad" }),
    ).toBeTruthy();
  });

  it("renders nothing when there is no dummy catalog to assign", () => {
    const { container } = render(
      <PositionActivitiesAssign activities={[]} positions={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByLabelText("Puesto a asignar")).toBeNull();
  });
});
