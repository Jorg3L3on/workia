import {
  ChartLineIcon,
  FileTextIcon,
  FolderTreeIcon,
  HomeIcon,
  LaptopIcon,
  PlugIcon,
  PlusIcon,
  ScrollTextIcon,
  UploadIcon,
  UserCogIcon,
  UserPlusIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";

import { CATALOG_NAV_CHILDREN, CATALOG_PATHS } from "@/lib/catalog/paths";

/**
 * The one navigation config (WRK-I6-7): the sidebar and the ⌘K palette are
 * both generated from it, so a page can't be in one and missing in the other.
 */

/** What the shell knows about the user, to hide what they cannot open. */
export type NavAccess = {
  canReadMembers: boolean;
  canUseConnections: boolean;
  canReadReports: boolean;
};

export type NavLink = {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Active only on this exact path (Inicio). */
  exact?: boolean;
  /** Extra words the palette matches on. */
  keywords?: string[];
  /** Hidden unless the user has this access. */
  requires?: keyof NavAccess;
  /** Sub-pages, shown as a collapsible in the sidebar (Catálogo). */
  children?: readonly { title: string; href: string }[];
};

export type NavGroup = {
  /** Sentence case: the sidebar shows it as is. */
  label: string;
  items: readonly NavLink[];
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Operación",
    items: [
      {
        title: "Inicio",
        href: "/app",
        icon: HomeIcon,
        exact: true,
        keywords: ["hoy", "pendientes"],
      },
      {
        title: "Personas",
        href: "/app/personas",
        icon: UsersIcon,
        keywords: ["expediente", "empleados"],
      },
      {
        title: "Contratos",
        href: "/app/contratos",
        icon: FileTextIcon,
        keywords: ["renovar", "vencimiento", "plantillas"],
      },
      {
        title: "Altas",
        href: "/app/altas",
        icon: UserPlusIcon,
        keywords: ["nóminas", "onboarding"],
      },
      {
        title: "Resguardo",
        href: "/app/resguardo",
        icon: LaptopIcon,
        keywords: ["activos", "equipo"],
      },
    ],
  },
  {
    label: "Reportes",
    items: [
      {
        title: "Rotación",
        href: "/app/reportes/rotacion",
        icon: ChartLineIcon,
        keywords: ["bajas", "rotación", "prueba", "90 días", "motivos"],
        requires: "canReadReports",
      },
    ],
  },
  {
    label: "Catálogo",
    items: [
      {
        title: "Catálogo",
        href: CATALOG_PATHS.index,
        icon: FolderTreeIcon,
        children: CATALOG_NAV_CHILDREN,
      },
    ],
  },
  {
    label: "Empresa",
    items: [
      {
        title: "Miembros",
        href: "/app/miembros",
        icon: UserCogIcon,
        keywords: ["usuarios", "roles", "accesos"],
        requires: "canReadMembers",
      },
      {
        title: "Conexiones",
        href: "/app/conexiones",
        icon: PlugIcon,
        keywords: ["mcp", "conector", "claude"],
        requires: "canUseConnections",
      },
      {
        title: "Auditoría",
        href: "/app/auditoria",
        icon: ScrollTextIcon,
        keywords: ["historial", "eventos", "bitácora"],
      },
    ],
  },
];

/** Pages reachable from the palette but not listed in the sidebar. */
export const NAV_EXTRA_PAGES: readonly NavLink[] = [
  {
    title: "Plantillas de contrato",
    href: "/app/contratos/plantillas",
    icon: FileTextIcon,
  },
  {
    title: "Importaciones",
    href: "/app/personas/importaciones",
    icon: UploadIcon,
    keywords: ["historial"],
  },
];

/** The main action of each module, for the palette. */
export const NAV_ACTIONS: readonly NavLink[] = [
  {
    title: "Nueva persona",
    href: "/app/personas/nueva",
    icon: PlusIcon,
    keywords: ["crear", "expediente"],
  },
  {
    title: "Importar personas",
    href: "/app/personas/importar",
    icon: UploadIcon,
    keywords: ["excel", "csv"],
  },
  {
    title: "Nuevo activo",
    href: "/app/resguardo/nuevo",
    icon: PlusIcon,
    keywords: ["resguardo", "equipo"],
  },
  {
    title: "Iniciar alta",
    href: "/app/altas",
    icon: UserPlusIcon,
    keywords: ["nóminas"],
  },
];

/** The footer link to the platform console, for platform admins only. */
export const PLATFORM_NAV_LINK = {
  title: "Plataforma",
  href: "/admin",
} as const;

const allowed = (item: NavLink, access: NavAccess) =>
  !item.requires || access[item.requires];

/** The groups this user sees, without empty ones. */
export const visibleNavGroups = (access: NavAccess): NavGroup[] =>
  NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => allowed(item, access)),
  })).filter((group) => group.items.length > 0);

export const isNavLinkActive = (pathname: string, item: NavLink) =>
  item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
