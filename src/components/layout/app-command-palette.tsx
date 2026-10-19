"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2Icon,
  FolderTreeIcon,
  SearchIcon,
  UserIcon,
} from "lucide-react";

import {
  CommandPalette,
  type CommandItem,
} from "@/components/motion/command-palette";
import { Button } from "@/components/ui/button";
import {
  NAV_ACTIONS,
  NAV_EXTRA_PAGES,
  visibleNavGroups,
  type NavAccess,
  type NavLink,
} from "@/lib/navigation";
import {
  searchPeopleForPaletteAction,
  type PersonSearchResult,
} from "@/lib/people/actions";

const OPEN_EVENT = "workia:open-command-palette";

/** Wait this long after the last key before searching people. */
const PEOPLE_SEARCH_DELAY_MS = 200;

export const openAppCommandPalette = () => {
  window.dispatchEvent(new Event(OPEN_EVENT));
};

type AppCommandPaletteProps = {
  access: NavAccess;
};

/** ⌘K: people as you type, then the main actions, then every page. */
export const AppCommandPalette = ({ access }: AppCommandPaletteProps) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<PersonSearchResult[]>([]);
  const searchSeq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setPeople([]);
    }
    setOpen(next);
  };

  useEffect(() => {
    const handleOpen = () => {
      setPeople([]);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_EVENT, handleOpen);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handleQueryChange = (query: string) => {
    if (timer.current) clearTimeout(timer.current);
    const seq = ++searchSeq.current;

    if (query.trim().length < 2) {
      setPeople([]);
      return;
    }

    timer.current = setTimeout(() => {
      void searchPeopleForPaletteAction(query).then((rows) => {
        // Only the latest query may write its results.
        if (seq === searchSeq.current) setPeople(rows);
      });
    }, PEOPLE_SEARCH_DELAY_MS);
  };

  const go =
    (href: string): CommandItem["onSelect"] =>
    () => {
      router.push(href);
    };

  const toItem = (link: NavLink, group: string): CommandItem => ({
    id: `${group}-${link.href}`,
    label: link.title,
    group,
    keywords: link.keywords,
    icon: link.icon,
    onSelect: go(link.href),
  });

  const pages = visibleNavGroups(access).flatMap((group) =>
    group.items.flatMap((link) => [
      toItem(link, "Ir a"),
      ...(link.children ?? []).map((child) =>
        toItem({ ...child, icon: FolderTreeIcon }, link.title),
      ),
    ]),
  );

  const items: CommandItem[] = [
    ...people.map((person) => ({
      id: `persona-${person.id}`,
      label: person.label,
      group: "Personas",
      badge: person.detail ? (
        <span className="text-muted-foreground text-xs tabular-nums">
          {person.detail}
        </span>
      ) : undefined,
      icon: UserIcon,
      alwaysShow: true,
      onSelect: go(`/app/personas/${person.id}`),
    })),
    ...NAV_ACTIONS.map((link) => toItem(link, "Acciones")),
    ...pages,
    ...NAV_EXTRA_PAGES.map((link) => toItem(link, "Ir a")),
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
      onOpenChange={handleOpenChange}
      onQueryChange={handleQueryChange}
      open={open}
      placeholder="Buscar personas, páginas y acciones…"
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
