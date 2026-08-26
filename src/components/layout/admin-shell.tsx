"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LayoutDashboardIcon, LogOutIcon, ShieldIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const adminNavItems = [
  {
    title: "Overview",
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

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/" });
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-sidebar-border border-b p-4">
          <Link className="font-semibold tracking-tight" href="/admin">
            workia admin
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Management</SidebarGroupLabel>
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
            className="w-full justify-start"
            variant="ghost"
            onClick={handleSignOut}
            type="button"
          >
            <LogOutIcon className="size-4" />
            Sign out
          </Button>
        </SidebarFooter>
      </Sidebar>
      <main className="flex min-h-full flex-1 flex-col">
        <header className="border-border flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <span className="text-muted-foreground text-sm">Administration</span>
        </header>
        <div className="flex-1 p-6">{children}</div>
      </main>
    </SidebarProvider>
  );
};
