"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { LayoutDashboardIcon, LogOutIcon, ShieldIcon } from "lucide-react";

import { AppBreadcrumbs } from "@/components/layout/app-breadcrumbs";
import {
  SHELL_INSET_SCROLL_CLASS_NAME,
  SHELL_TOP_NAV_CLASS_NAME,
  SHELL_VIEWPORT_CLASS_NAME,
} from "@/components/layout/shell-top-nav";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const adminNavItems = [
  {
    title: "Resumen",
    href: "/admin",
    icon: LayoutDashboardIcon,
  },
  {
    title: "RBAC",
    href: "/admin/rbac",
    icon: ShieldIcon,
  },
];

type AdminShellProps = {
  children: React.ReactNode;
};

export const AdminShell = ({ children }: AdminShellProps) => {
  const pathname = usePathname();
  const router = useRouter();

  const handleCerrarSesionClick = async () => {
    await signOut({ redirect: false });
    router.push("/login");
  };

  return (
    <SidebarProvider className={SHELL_VIEWPORT_CLASS_NAME}>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-sidebar-border border-b p-4">
          <Link className="font-semibold tracking-tight" href="/admin">
            workia admin
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Administración</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
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
        <SidebarFooter className="border-sidebar-border border-t p-2">
          <Button
            aria-label="Cerrar sesión"
            className="w-full justify-start"
            variant="ghost"
            type="button"
            onClick={() => {
              void handleCerrarSesionClick();
            }}
          >
            <LogOutIcon className="size-4" />
            Cerrar sesión
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className={SHELL_INSET_SCROLL_CLASS_NAME}>
        <header
          className={cn(
            "border-border flex h-14 shrink-0 items-center gap-2 border-b px-4",
            SHELL_TOP_NAV_CLASS_NAME,
          )}
          data-slot="shell-top-nav"
        >
          <SidebarTrigger />
          <Separator
            className="mr-2 data-[orientation=vertical]:h-4"
            orientation="vertical"
          />
          <AppBreadcrumbs />
        </header>
        <div className="flex-1 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
};
