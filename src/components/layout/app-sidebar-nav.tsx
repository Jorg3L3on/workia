"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { CATALOG_NAV_CHILDREN, CATALOG_PATHS } from "@/lib/catalog/paths";

type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  exact?: boolean;
};

type AppSidebarNavProps = {
  items: readonly NavItem[];
};

const isItemActive = (pathname: string, item: NavItem) => {
  if (item.exact) {
    return pathname === item.href;
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`);
};

const isCatalogRoute = (pathname: string) =>
  pathname === CATALOG_PATHS.index ||
  pathname.startsWith(`${CATALOG_PATHS.index}/`);

export const AppSidebarNav = ({ items }: AppSidebarNavProps) => {
  const pathname = usePathname();
  const router = useRouter();
  const { state, isMobile } = useSidebar();
  const catalogActive = isCatalogRoute(pathname);
  const [catalogManualOpen, setCatalogManualOpen] = useState(false);
  const catalogOpen = catalogActive || catalogManualOpen;

  const handleCatalogOpenChange = (nextOpen: boolean) => {
    if (catalogActive && !nextOpen) {
      return;
    }

    setCatalogManualOpen(nextOpen);
  };

  const handleCatalogParentClick = () => {
    if (state === "collapsed" && !isMobile) {
      router.push(CATALOG_PATHS.index);
    }
  };

  const catalogItem = items.find((item) => item.href === CATALOG_PATHS.index);
  const leadingItems = items.filter(
    (item) =>
      item.href !== CATALOG_PATHS.index && item.href !== "/app/auditoria",
  );
  const trailingItems = items.filter((item) => item.href === "/app/auditoria");

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="font-mono text-[10px] tracking-[0.08em] uppercase">
        Expediente
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {leadingItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={isItemActive(pathname, item)}
                tooltip={item.title}
              >
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}

          {catalogItem ? (
            <Collapsible
              asChild
              className="group/collapsible"
              onOpenChange={handleCatalogOpenChange}
              open={catalogOpen}
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    isActive={false}
                    tooltip={catalogItem.title}
                    type="button"
                    onClick={handleCatalogParentClick}
                  >
                    <catalogItem.icon />
                    <span>{catalogItem.title}</span>
                    <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {CATALOG_NAV_CHILDREN.map((child) => (
                      <SidebarMenuSubItem key={child.href}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={pathname === child.href}
                        >
                          <Link href={child.href}>
                            <span>{child.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          ) : null}

          {trailingItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={isItemActive(pathname, item)}
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
  );
};
