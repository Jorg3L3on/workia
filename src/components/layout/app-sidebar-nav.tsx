"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { SharedLayoutBg } from "@/components/motion/shared-layout-bg";
import { isNavLinkActive, type NavGroup, type NavLink } from "@/lib/navigation";

type AppSidebarNavProps = {
  groups: readonly NavGroup[];
};

const NavCollapsible = ({ item }: { item: NavLink }) => {
  const pathname = usePathname();
  const router = useRouter();
  const { state, isMobile } = useSidebar();
  const active = isNavLinkActive(pathname, item);
  const [manualOpen, setManualOpen] = useState(false);
  const open = active || manualOpen;

  const handleOpenChange = (nextOpen: boolean) => {
    if (active && !nextOpen) {
      return;
    }

    setManualOpen(nextOpen);
  };

  // Collapsed to icons there is no room for the sub-list: go to the index.
  const handleParentClick = () => {
    if (state === "collapsed" && !isMobile) {
      router.push(item.href);
    }
  };

  return (
    <Collapsible
      className="group/collapsible"
      onOpenChange={handleOpenChange}
      open={open}
    >
      <CollapsibleTrigger asChild>
        <SidebarMenuButton
          className="hover:bg-transparent"
          isActive={false}
          tooltip={item.title}
          type="button"
          onClick={handleParentClick}
        >
          <item.icon />
          <span>{item.title}</span>
          <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
        </SidebarMenuButton>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarMenuSub>
          {item.children?.map((child) => (
            <SidebarMenuSubItem key={child.href}>
              <SidebarMenuSubButton asChild isActive={pathname === child.href}>
                <Link href={child.href}>
                  <span>{child.title}</span>
                </Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  );
};

/** The /app sidebar, one SidebarGroup per group of the navigation config. */
export const AppSidebarNav = ({ groups }: AppSidebarNavProps) => {
  const pathname = usePathname();

  return groups.map((group) => {
    // A group that is a single collapsible of the same name (Catálogo) needs
    // no label above it.
    const showLabel = !(
      group.items.length === 1 && group.items[0]?.title === group.label
    );

    return (
      <SidebarGroup className="py-1" key={group.label}>
        {showLabel ? (
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
        ) : null}
        <SidebarGroupContent>
          <SharedLayoutBg
            aria-label={group.label}
            as="ul"
            className="flex w-full min-w-0 flex-col gap-0"
            data-sidebar="menu"
            data-slot="sidebar-menu"
            enableLayoutRoot={false}
            inset={0}
            pillClassName="rounded-md bg-sidebar-accent"
          >
            {group.items.map((item) => (
              <li
                className="group/menu-item relative"
                data-sidebar="menu-item"
                data-slot="sidebar-menu-item"
                key={item.href}
              >
                {item.children ? (
                  <NavCollapsible item={item} />
                ) : (
                  <SidebarMenuButton
                    asChild
                    className="hover:bg-transparent"
                    isActive={isNavLinkActive(pathname, item)}
                    tooltip={item.title}
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                )}
              </li>
            ))}
          </SharedLayoutBg>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  });
};
