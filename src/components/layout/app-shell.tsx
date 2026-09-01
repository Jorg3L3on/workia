"use client";

import Link from "next/link";
import {
  FileTextIcon,
  FolderTreeIcon,
  HomeIcon,
  LaptopIcon,
  ScrollTextIcon,
  UsersIcon,
} from "lucide-react";

import { WorkiaMark } from "@/components/brand/workia-mark";
import {
  AppBreadcrumbs,
  BreadcrumbLabelsProvider,
} from "@/components/layout/app-breadcrumbs";
import {
  AppCommandPalette,
  AppCommandPaletteHint,
} from "@/components/layout/app-command-palette";
import { AppSidebarNav } from "@/components/layout/app-sidebar-nav";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import {
  SHELL_INSET_CLASS_NAME,
  SHELL_MAIN_SCROLL_CLASS_NAME,
  SHELL_TOP_NAV_CLASS_NAME,
  SHELL_VIEWPORT_CLASS_NAME,
} from "@/components/layout/shell-top-nav";
import { NavUser } from "@/components/nav-user";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { CATALOG_PATHS } from "@/lib/catalog/paths";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

const navItems = [
  { title: "Inicio", href: "/app", icon: HomeIcon, exact: true },
  { title: "Personas", href: "/app/personas", icon: UsersIcon },
  { title: "Contratos", href: "/app/contratos", icon: FileTextIcon },
  { title: "Resguardo", href: "/app/resguardo", icon: LaptopIcon },
  { title: "Catálogo", href: CATALOG_PATHS.index, icon: FolderTreeIcon },
  { title: "Auditoría", href: "/app/auditoria", icon: ScrollTextIcon },
] as const;

export const AppShell = ({ children, user }: AppShellProps) => {
  const initials = (user.name ?? "RRHH")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <BreadcrumbLabelsProvider>
      <div
        className={cn(
          "workia-shell relative flex flex-col",
          SHELL_VIEWPORT_CLASS_NAME,
        )}
      >
        <SidebarProvider
          className={cn("relative z-10 flex w-full", SHELL_VIEWPORT_CLASS_NAME)}
        >
          <NavigationProgress />
          <AppCommandPalette />
          <Sidebar
            collapsible="icon"
            className="border-sidebar-border border-r"
          >
            <SidebarHeader className="border-sidebar-border border-b p-3">
              <Link
                className="flex items-center gap-2.5 px-1 font-semibold tracking-tight"
                href="/app"
              >
                <WorkiaMark className="size-7" />
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  workia
                </span>
              </Link>
            </SidebarHeader>
            <SidebarContent>
              <AppSidebarNav items={navItems} />
            </SidebarContent>
            <SidebarFooter className="border-sidebar-border border-t">
              <NavUser
                user={{
                  name: user.name ?? "Usuario",
                  email: user.email ?? "",
                  avatar: user.image ?? "",
                  initials,
                }}
              />
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>

          <SidebarInset
            className={cn("bg-transparent", SHELL_INSET_CLASS_NAME)}
          >
            <header
              className={cn(
                "workia-credential-header flex h-14 shrink-0 items-center gap-2 border-b",
                SHELL_TOP_NAV_CLASS_NAME,
              )}
              data-slot="shell-top-nav"
            >
              <div className="flex flex-1 items-center gap-2 px-4">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  className="mr-2 data-[orientation=vertical]:h-4"
                  orientation="vertical"
                />
                <AppBreadcrumbs />
              </div>
              <div className="flex items-center gap-1 px-4">
                <AppCommandPaletteHint />
                <ThemeToggle />
              </div>
            </header>
            <div
              className={cn(
                "mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6",
                SHELL_MAIN_SCROLL_CLASS_NAME,
              )}
              data-slot="shell-main-scroll"
            >
              {children}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </BreadcrumbLabelsProvider>
  );
};
