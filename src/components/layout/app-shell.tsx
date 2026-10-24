"use client";

import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";

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
import { SidebarWheelForward } from "@/components/layout/sidebar-wheel-forward";
import {
  SHELL_CONTENT_COLUMN_CLASS_NAME,
  SHELL_INSET_CLASS_NAME,
  SHELL_MAIN_SCROLL_CLASS_NAME,
  SHELL_TOP_NAV_CLASS_NAME,
  SHELL_VIEWPORT_CLASS_NAME,
} from "@/components/layout/shell-top-nav";
import { NavUser } from "@/components/nav-user";
import { CompanyProvider } from "@/components/tenant/company-context";
import { CompanySwitcher } from "@/components/tenant/company-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { PLATFORM_NAV_LINK, visibleNavGroups } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type CompanyOption = { id: string; name: string; roleName: string };

type AppShellProps = {
  children: React.ReactNode;
  /** The company this request acts in, and every company the user can switch to. */
  company: CompanyOption;
  companies: CompanyOption[];
  /** members:read in the active company: shows Miembros. */
  canReadMembers?: boolean;
  /** mcp_connections:create or :manage in the active company: shows Conexiones. */
  canUseConnections?: boolean;
  /** reports:read in the active company: shows Reportes. */
  canReadReports?: boolean;
  /** Platform admins also get a link to the platform console. */
  isPlatformAdmin?: boolean;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

export const AppShell = ({
  children,
  user,
  company,
  companies,
  canReadMembers = false,
  canUseConnections = false,
  canReadReports = false,
  isPlatformAdmin = false,
}: AppShellProps) => {
  const access = { canReadMembers, canUseConnections, canReadReports };
  const groups = visibleNavGroups(access);
  const initials = (user.name ?? "RRHH")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <CompanyProvider company={{ id: company.id, name: company.name }}>
      <BreadcrumbLabelsProvider>
        <div
          className={cn(
            "workia-shell relative flex flex-col",
            SHELL_VIEWPORT_CLASS_NAME,
          )}
        >
          <SidebarProvider
            className={cn(
              "relative z-10 flex w-full",
              SHELL_VIEWPORT_CLASS_NAME,
            )}
          >
            <NavigationProgress />
            <SidebarWheelForward />
            <AppCommandPalette access={access} />
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
                <CompanySwitcher current={company} companies={companies} />
              </SidebarHeader>
              <SidebarContent>
                <AppSidebarNav groups={groups} />
              </SidebarContent>
              <SidebarFooter className="border-sidebar-border border-t">
                {isPlatformAdmin ? (
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        className="text-muted-foreground"
                        size="sm"
                        tooltip={PLATFORM_NAV_LINK.title}
                      >
                        <Link href={PLATFORM_NAV_LINK.href}>
                          <ArrowUpRightIcon aria-hidden />
                          <span>{PLATFORM_NAV_LINK.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                ) : null}
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
                  "w-full p-4 md:p-6",
                  SHELL_MAIN_SCROLL_CLASS_NAME,
                )}
                data-slot="shell-main-scroll"
              >
                <div
                  className={SHELL_CONTENT_COLUMN_CLASS_NAME}
                  data-slot="shell-content-column"
                >
                  {children}
                </div>
              </div>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </BreadcrumbLabelsProvider>
    </CompanyProvider>
  );
};
