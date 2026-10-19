"use client";

import { ListPlusIcon, PlusIcon, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";

export type CatalogFormTrayAction = {
  id: string;
  actionLabel: string;
  formTitle: string;
  icon?: LucideIcon;
  children: ReactNode;
};

type CatalogFormTrayProps = {
  /** The page header: its primary (and secondary) open these forms. */
  title: string;
  description?: string;
  actions: CatalogFormTrayAction[];
};

/**
 * A catálogo page's header and its inline create forms: the first action is
 * the header's primary, a second one its secondary. F5 swaps them for Sheets.
 */
export const CatalogFormTray = ({
  title,
  description,
  actions,
}: CatalogFormTrayProps) => {
  const [openActionId, setOpenActionId] = useState<string | null>(null);

  const handleToggleAction = (actionId: string) => {
    setOpenActionId((current) => (current === actionId ? null : actionId));
  };

  const handleCloseForm = () => {
    setOpenActionId(null);
  };

  const openAction = actions.find((action) => action.id === openActionId);
  const formId = openAction ? `catalog-form-${openAction.id}` : undefined;

  const trigger = (
    action: CatalogFormTrayAction | undefined,
    variant: "primary" | "secondary",
    fallbackIcon: LucideIcon,
  ) => {
    if (!action) {
      return null;
    }

    const isFormOpen = openActionId === action.id;
    const Icon = action.icon ?? fallbackIcon;

    return (
      <Button
        aria-controls={isFormOpen ? `catalog-form-${action.id}` : undefined}
        aria-expanded={isFormOpen}
        onClick={() => handleToggleAction(action.id)}
        type="button"
        variant={variant}
      >
        <Icon aria-hidden />
        {action.actionLabel}
      </Button>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        description={description}
        primary={trigger(actions[0], "primary", PlusIcon)}
        secondary={trigger(actions[1], "secondary", ListPlusIcon)}
        title={title}
      />
      {openAction && formId ? (
        <div className="bg-muted/20 space-y-3 rounded-lg p-4" id={formId}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{openAction.formTitle}</p>
            <Button
              aria-label={`Cerrar formulario de ${openAction.formTitle.toLowerCase()}`}
              className="h-8 px-3 text-xs font-medium"
              onClick={handleCloseForm}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cerrar
            </Button>
          </div>
          {openAction.children}
        </div>
      ) : null}
    </div>
  );
};
