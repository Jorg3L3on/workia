import { describe, expect, it } from "vitest";

import { resolveBreadcrumbs } from "@/lib/navigation/breadcrumbs";

describe("resolveBreadcrumbs", () => {
  it("shows Inicio as the current page on the home route", () => {
    expect(resolveBreadcrumbs("/app")).toEqual([{ label: "Inicio" }]);
  });

  it("nests the expediente under Personas with the person name", () => {
    expect(
      resolveBreadcrumbs("/app/personas/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", {
        current: "Elena Demo",
      }),
    ).toEqual([
      { label: "Personas", href: "/app/personas" },
      { label: "Elena Demo" },
    ]);
  });

  it("nests a resguardo asset under Resguardo", () => {
    expect(
      resolveBreadcrumbs(
        "/app/resguardo/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        {
          current: "Laptop demo",
        },
      ),
    ).toEqual([
      { label: "Resguardo", href: "/app/resguardo" },
      { label: "Laptop demo" },
    ]);
  });

  it("nests catalog children under Catálogo", () => {
    expect(resolveBreadcrumbs("/app/catalogo/areas")).toEqual([
      { label: "Catálogo", href: "/app/catalogo" },
      { label: "Áreas" },
    ]);
    expect(resolveBreadcrumbs("/app/catalogo/puestos")).toEqual([
      { label: "Catálogo", href: "/app/catalogo" },
      { label: "Puestos" },
    ]);
    expect(resolveBreadcrumbs("/app/catalogo/sucursales")).toEqual([
      { label: "Catálogo", href: "/app/catalogo" },
      { label: "Sucursales" },
    ]);
  });

  it("covers Contratos, plantillas, Auditoría and admin", () => {
    expect(resolveBreadcrumbs("/app/contratos")).toEqual([
      { label: "Contratos" },
    ]);
    expect(resolveBreadcrumbs("/app/contratos/plantillas")).toEqual([
      { label: "Contratos", href: "/app/contratos" },
      { label: "Plantillas" },
    ]);
    expect(resolveBreadcrumbs("/app/auditoria")).toEqual([
      { label: "Auditoría" },
    ]);
    expect(resolveBreadcrumbs("/admin")).toEqual([{ label: "Administración" }]);
    expect(resolveBreadcrumbs("/admin/rbac")).toEqual([
      { label: "Administración", href: "/admin" },
      { label: "RBAC" },
    ]);
  });

  it("does not invent public chrome for login or landing", () => {
    expect(resolveBreadcrumbs("/")).toEqual([]);
    expect(resolveBreadcrumbs("/login")).toEqual([]);
  });
});
