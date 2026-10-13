"use client";

import { useTransition } from "react";
import { Building2Icon, CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { companyCopy } from "@/lib/brand/chrome-copy";
import { switchCompanyAction } from "@/lib/tenant/actions";

type CompanySwitcherProps = {
  current: { id: string; name: string; roleName: string };
  companies: { id: string; name: string; roleName: string }[];
};

/** Shows the active company; with several memberships, switches between them. */
export const CompanySwitcher = ({
  current,
  companies,
}: CompanySwitcherProps) => {
  const { isMobile } = useSidebar();
  const [pending, startTransition] = useTransition();
  const canSwitch = companies.length > 1;

  const switchTo = (companyId: string) => {
    if (companyId === current.id) {
      return;
    }

    const formData = new FormData();
    formData.set("companyId", companyId);

    startTransition(async () => {
      // On success the action redirects to /app in the new company.
      const result = await switchCompanyAction({}, formData);

      if (result?.error) {
        toast.error(result.error);
      }
    });
  };

  const label = (
    <>
      <span className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg">
        <Building2Icon className="size-4" aria-hidden />
      </span>
      <span className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-medium" data-testid="active-company">
          {current.name}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {current.roleName}
        </span>
      </span>
    </>
  );

  if (!canSwitch) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="cursor-default" asChild>
            <div>{label}</div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              disabled={pending}
              aria-label={companyCopy.switchLabel}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {label}
              <ChevronsUpDownIcon
                className="ml-auto size-4 group-data-[collapsible=icon]:hidden"
                aria-hidden
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              {companyCopy.switchLabel}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {companies.map((company) => (
              <DropdownMenuItem
                key={company.id}
                onSelect={() => switchTo(company.id)}
                className="gap-2"
              >
                <span className="grid flex-1 leading-tight">
                  <span className="truncate">{company.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {company.roleName}
                  </span>
                </span>
                {company.id === current.id ? (
                  <CheckIcon className="size-4" aria-label="Empresa actual" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};
