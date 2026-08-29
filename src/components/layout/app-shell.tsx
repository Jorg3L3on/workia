"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileTextIcon,
  FolderTreeIcon,
  HomeIcon,
  ScrollTextIcon,
  UsersIcon,
} from "lucide-react";

import { WorkiaMark } from "@/components/brand/workia-mark";
import { SHELL_TOP_NAV_CLASS_NAME } from "@/components/layout/shell-top-nav";
import { NavUser } from "@/components/nav-user";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
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
  { title: "Inicio", href: "/app", icon: HomeIcon },
  { title: "Personas", href: "/app/personas", icon: UsersIcon },
  { title: "Contratos", href: "/app/contratos", icon: FileTextIcon },
  { title: "Catálogo", href: "/app/catalogo", icon: FolderTreeIcon },
  { title: "Auditoría", href: "/app/auditoria", icon: ScrollTextIcon },
] as const;

const getPageTitle = (pathname: string) => {
  if (pathname === "/app") {
    return "Inicio";
  }

  if (pathname.startsWith("/app/personas")) {
    return "Personas";
  }

  if (pathname.startsWith("/app/contratos")) {
    return "Contratos";
  }

  if (pathname.startsWith("/app/catalogo")) {
    return "Catálogo";
  }

  if (pathname.startsWith("/app/auditoria")) {
    return "Auditoría";
  }

  const segment = pathname.split("/").filter(Boolean).at(-1);
  if (!segment) {
    return "Inicio";
  }

  return segment.charAt(0).toUpperCase() + segment.slice(1);
};

export const AppShell = ({ children, user }: AppShellProps) => {
  const pathname = usePathname();
  const pageTitle = getPageTitle(pathname);

  const initials = (user.name ?? "RRHH")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="workia-shell relative flex min-h-full flex-col">
      <div
        className="workia-shell-grain pointer-events-none absolute inset-0 z-0"
        aria-hidden
      />

      <SidebarProvider className="relative z-10 flex min-h-full w-full">
        <Sidebar collapsible="icon" className="border-sidebar-border border-r">
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
            <div
              className="workia-credential-slot mx-1 mt-3 group-data-[collapsible=icon]:hidden"
              aria-hidden
            />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="font-mono text-[10px] tracking-[0.08em] uppercase">
                Expediente
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={
                          item.href === "/app"
                            ? pathname === "/app"
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

        <SidebarInset className="bg-transparent">
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
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden md:block">
                    <BreadcrumbLink href="/app">workia</BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            <div className="px-4">
              <ThemeToggle />
            </div>
          </header>
          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 md:p-6">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
};
