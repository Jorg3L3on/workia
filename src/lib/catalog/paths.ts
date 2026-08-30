export const CATALOG_PATHS = {
  index: "/app/catalogo",
  areas: "/app/catalogo/areas",
  puestos: "/app/catalogo/puestos",
  sucursales: "/app/catalogo/sucursales",
} as const;

export type CatalogPath = (typeof CATALOG_PATHS)[keyof typeof CATALOG_PATHS];

export const catalogHref = (
  path: CatalogPath,
  query?: Record<string, string>,
) => {
  if (!query) {
    return path;
  }

  const params = new URLSearchParams(query);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

export const CATALOG_NAV_CHILDREN = [
  { title: "Áreas", href: CATALOG_PATHS.areas },
  { title: "Puestos", href: CATALOG_PATHS.puestos },
  { title: "Sucursales", href: CATALOG_PATHS.sucursales },
] as const;
