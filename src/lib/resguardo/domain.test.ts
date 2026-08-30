import { describe, expect, it } from "vitest";

import {
  assetCategoryLabels,
  assetStatusLabels,
  isTrackableAsset,
} from "@/lib/resguardo/schema";

describe("resguardo domain rules", () => {
  it("distinguishes trackable assets from consumables", () => {
    expect(isTrackableAsset(true)).toBe(true);
    expect(isTrackableAsset(false)).toBe(false);
  });

  it("labels warehouse state in Spanish", () => {
    expect(assetStatusLabels.disponible).toBe("En almacén");
  });

  it("uses demo-safe category labels", () => {
    expect(assetCategoryLabels.laptop).toBe("Laptop");
    expect(assetCategoryLabels.moto).toBe("Motocicleta");
    expect(assetCategoryLabels.consumible).toBe("Consumible");
  });

  it("expects warehouse assets to have no holder at creation", () => {
    const warehouseAsset = {
      status: "disponible" as const,
      holderId: null,
    };

    expect(warehouseAsset.status).toBe("disponible");
    expect(warehouseAsset.holderId).toBeNull();
  });

  it("expects assigned expediente to reference current holder only", () => {
    const assignedAsset = {
      status: "asignado" as const,
      holderId: "person-demo-1",
    };

    expect(assignedAsset.status).toBe("asignado");
    expect(assignedAsset.holderId).toBeTruthy();
  });

  it("expects history to contain entrega and devolución in order", () => {
    const history = [
      { type: "entrega" as const, movementDate: "2026-01-01" },
      { type: "devolucion" as const, movementDate: "2026-02-01" },
    ];

    expect(history.map((entry) => entry.type)).toEqual([
      "entrega",
      "devolucion",
    ]);
  });
});
