import { CATALOG_PATHS } from "@/lib/catalog/paths";

export type BreadcrumbCrumb = {
  label: string;
  href?: string;
};

export type BreadcrumbLabels = {
  current?: string;
};

const stripTrailingSlash = (pathname: string) =>
  pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;

export const resolveBreadcrumbs = (
  pathname: string,
  labels: BreadcrumbLabels = {},
): BreadcrumbCrumb[] => {
  const path = stripTrailingSlash(pathname);

  if (path === "/app") {
    return [{ label: "Inicio" }];
  }

  if (path === "/app/personas") {
    return [{ label: "Personas" }];
  }

  if (path === "/app/personas/nueva") {
    return [
      { label: "Personas", href: "/app/personas" },
      { label: "Nueva persona" },
    ];
  }

  if (path.startsWith("/app/personas/")) {
    return [
      { label: "Personas", href: "/app/personas" },
      { label: labels.current ?? "Expediente" },
    ];
  }

  if (path === "/app/contratos") {
    return [{ label: "Contratos" }];
  }

  if (path === "/app/contratos/plantillas") {
    return [
      { label: "Contratos", href: "/app/contratos" },
      { label: "Plantillas" },
    ];
  }

  if (path === "/app/contratos/plantillas/nueva") {
    return [
      { label: "Contratos", href: "/app/contratos" },
      { label: "Plantillas", href: "/app/contratos/plantillas" },
      { label: "Nueva plantilla" },
    ];
  }

  if (path.startsWith("/app/contratos/plantillas/")) {
    return [
      { label: "Contratos", href: "/app/contratos" },
      { label: "Plantillas", href: "/app/contratos/plantillas" },
      { label: labels.current ?? "Plantilla" },
    ];
  }

  if (path === "/app/resguardo") {
    return [{ label: "Resguardo" }];
  }

  if (path === "/app/resguardo/nuevo") {
    return [
      { label: "Resguardo", href: "/app/resguardo" },
      { label: "Nuevo activo" },
    ];
  }

  if (path.startsWith("/app/resguardo/")) {
    return [
      { label: "Resguardo", href: "/app/resguardo" },
      { label: labels.current ?? "Activo" },
    ];
  }

  if (path === CATALOG_PATHS.index || path === CATALOG_PATHS.areas) {
    return [
      { label: "Catálogo", href: CATALOG_PATHS.index },
      { label: "Áreas" },
    ];
  }

  if (path === CATALOG_PATHS.puestos) {
    return [
      { label: "Catálogo", href: CATALOG_PATHS.index },
      { label: "Puestos" },
    ];
  }

  if (path === CATALOG_PATHS.actividades) {
    return [
      { label: "Catálogo", href: CATALOG_PATHS.index },
      { label: "Actividades" },
    ];
  }

  if (path === CATALOG_PATHS.sucursales) {
    return [
      { label: "Catálogo", href: CATALOG_PATHS.index },
      { label: "Sucursales" },
    ];
  }

  if (path === "/app/auditoria") {
    return [{ label: "Auditoría" }];
  }

  if (path === "/admin") {
    return [{ label: "Administración" }];
  }

  if (path === "/admin/rbac") {
    return [{ label: "Administración", href: "/admin" }, { label: "RBAC" }];
  }

  if (path.startsWith("/admin/")) {
    return [{ label: "Administración", href: "/admin" }];
  }

  if (path.startsWith("/app/")) {
    return [{ label: "Inicio", href: "/app" }];
  }

  return [];
};
