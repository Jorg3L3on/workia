"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2Icon,
  FileTextIcon,
  FolderTreeIcon,
  HomeIcon,
  LaptopIcon,
  ScrollTextIcon,
  SearchIcon,
  UsersIcon,
} from "lucide-react";

import {
  CommandPalette,
  type CommandItem,
} from "@/components/motion/command-palette";
import { Button } from "@/components/ui/button";
import { CATALOG_NAV_CHILDREN, CATALOG_PATHS } from "@/lib/catalog/paths";

const OPEN_EVENT = "workia:open-command-palette";

export const openAppCommandPalette = () => {
  window.dispatchEvent(new Event(OPEN_EVENT));
};

export const AppCommandPalette = () => {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);

  const go =
    (href: string): CommandItem["onSelect"] =>
    () => {
      router.push(href);
    };

  const items: CommandItem[] = [
    {
      id: "inicio",
      label: "Inicio",
      group: "Ir a",
      keywords: ["home", "hoy", "dashboard"],
      icon: HomeIcon,
      onSelect: go("/app"),
    },
    {
      id: "personas",
      label: "Personas",
      group: "Ir a",
      keywords: ["expediente", "empleados"],
      icon: UsersIcon,
      onSelect: go("/app/personas"),
    },
    {
      id: "personas-nueva",
      label: "Nueva persona",
      group: "Acciones",
      keywords: ["alta", "crear"],
      icon: UsersIcon,
      onSelect: go("/app/personas/nueva"),
    },
    {
      id: "contratos",
      label: "Contratos",
      group: "Ir a",
      keywords: ["renovar", "vencimiento"],
      icon: FileTextIcon,
      onSelect: go("/app/contratos"),
    },
    {
      id: "plantillas",
      label: "Plantillas de contrato",
      group: "Ir a",
      icon: FileTextIcon,
      onSelect: go("/app/contratos/plantillas"),
    },
    {
      id: "resguardo",
      label: "Inventario",
      group: "Ir a",
      keywords: ["activos", "resguardo"],
      icon: LaptopIcon,
      onSelect: go("/app/resguardo"),
    },
    {
      id: "catalogo",
      label: "Catálogo",
      group: "Ir a",
      icon: FolderTreeIcon,
      onSelect: go(CATALOG_PATHS.index),
    },
    ...CATALOG_NAV_CHILDREN.map((child) => ({
      id: `catalogo-${child.href}`,
      label: child.title,
      group: "Catálogo",
      icon: FolderTreeIcon,
      onSelect: go(child.href),
    })),
    {
      id: "auditoria",
      label: "Auditoría",
      group: "Ir a",
      keywords: ["historial", "eventos"],
      icon: ScrollTextIcon,
      onSelect: go("/app/auditoria"),
    },
    {
      id: "cambiar-empresa",
      label: "Cambiar de empresa",
      group: "Empresa",
      keywords: ["empresa", "compañía", "cambiar"],
      icon: Building2Icon,
      onSelect: go("/empresa"),
    },
  ];

  return (
    <CommandPalette
      emptyMessage="Sin coincidencias."
      items={items}
      onOpenChange={setOpen}
      open={open}
      placeholder="Buscar páginas y acciones…"
    />
  );
};

export const AppCommandPaletteHint = () => (
  <Button
    aria-keyshortcuts="Meta+K"
    aria-label="Buscar en Workia"
    className="text-muted-foreground hidden w-48 justify-start sm:inline-flex"
    onClick={openAppCommandPalette}
    type="button"
    variant="secondary"
  >
    <SearchIcon aria-hidden />
    Buscar
    <kbd className="bg-muted ml-auto rounded px-1.5 font-sans text-[11px] font-medium">
      ⌘K
    </kbd>
  </Button>
);
