"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftIcon,
  Building2Icon,
  LayoutDashboardIcon,
  ShieldIcon,
} from "lucide-react";

import { WorkiaMark } from "@/components/brand/workia-mark";
import {
  AppBreadcrumbs,
  BreadcrumbLabelsProvider,
} from "@/components/layout/app-breadcrumbs";
import { NavigationProgress } from "@/components/layout/navigation-progress";
import {
  SHELL_INSET_CLASS_NAME,
  SHELL_MAIN_SCROLL_CLASS_NAME,
  SHELL_TOP_NAV_CLASS_NAME,
  SHELL_VIEWPORT_CLASS_NAME,
} from "@/components/layout/shell-top-nav";
import { NavUser } from "@/components/nav-user";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { cn } from "@/lib/utils";

const adminNavItems = [
  { title: "Resumen", href: "/admin", icon: LayoutDashboardIcon, exact: true },
  { title: "Empresas", href: "/admin/empresas", icon: Building2Icon },
  { title: pageTitles.rbac, href: "/admin/rbac", icon: ShieldIcon },
];

type AdminShellProps = {
  children: React.ReactNode;
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

/** The /admin shell: the /app brand and chrome with an «Administración» badge. */
export const AdminShell = ({ children, user }: AdminShellProps) => {
  const pathname = usePathname();
  const initials = (user.name ?? "Admin")
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
          <Sidebar
            collapsible="icon"
            className="border-sidebar-border border-r"
          >
            <SidebarHeader className="border-sidebar-border border-b p-3">
              <Link
                className="flex items-center gap-2.5 px-1 font-semibold tracking-tight"
                href="/admin"
              >
                <WorkiaMark className="size-7" />
                <span className="truncate group-data-[collapsible=icon]:hidden">
                  workia
                </span>
                <Badge
                  className="group-data-[collapsible=icon]:hidden"
                  tone="info"
                >
                  Administración
                </Badge>
              </Link>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {adminNavItems.map((item) => (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={
                            item.exact
                              ? pathname === item.href
                              : pathname.startsWith(item.href)
                          }
                          tooltip={item.title}
                        >
                          <Link href={item.href}>
                            <item.icon />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter className="border-sidebar-border border-t">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    className="text-muted-foreground"
                    size="sm"
                    tooltip="Volver a la app"
                  >
                    <Link href="/app">
                      <ArrowLeftIcon aria-hidden />
                      <span>Volver a la app</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
              <NavUser
                user={{
                  name: user.name ?? "Administrador",
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
