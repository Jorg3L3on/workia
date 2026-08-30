import { describe, expect, it } from "vitest";

import {
  CATALOG_NAV_CHILDREN,
  CATALOG_PATHS,
  catalogHref,
} from "@/lib/catalog/paths";

describe("catalog paths", () => {
  it("uses ASCII routes for the catalog children", () => {
    expect(CATALOG_PATHS.areas).toBe("/app/catalogo/areas");
    expect(CATALOG_PATHS.puestos).toBe("/app/catalogo/puestos");
    expect(CATALOG_PATHS.actividades).toBe("/app/catalogo/actividades");
    expect(CATALOG_PATHS.sucursales).toBe("/app/catalogo/sucursales");
  });

  it("lists áreas, puestos, actividades and sucursales", () => {
    expect(CATALOG_NAV_CHILDREN.map((child) => child.title)).toEqual([
      "Áreas",
      "Puestos",
      "Actividades",
      "Sucursales",
    ]);
  });

  it("appends query strings for redirects", () => {
    expect(catalogHref(CATALOG_PATHS.areas, { saved: "area" })).toBe(
      "/app/catalogo/areas?saved=area",
    );
  });
});
