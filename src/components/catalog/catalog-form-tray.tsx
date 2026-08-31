"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

export type CatalogFormTrayAction = {
  id: string;
  actionLabel: string;
  formTitle: string;
  children: ReactNode;
};

type CatalogFormTrayProps = {
  actions: CatalogFormTrayAction[];
};

export const CatalogFormTray = ({ actions }: CatalogFormTrayProps) => {
  const [openActionId, setOpenActionId] = useState<string | null>(null);

  if (actions.length === 0) {
    return null;
  }

  const handleToggleAction = (actionId: string) => {
    setOpenActionId((current) => (current === actionId ? null : actionId));
  };

  const handleCloseForm = () => {
    setOpenActionId(null);
  };

  const openAction = actions.find((action) => action.id === openActionId);
  const formId = openAction ? `catalog-form-${openAction.id}` : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((action) => {
          const isFormOpen = openActionId === action.id;

          return (
            <Button
              aria-controls={
                isFormOpen ? `catalog-form-${action.id}` : undefined
              }
              aria-expanded={isFormOpen}
              className="h-8 px-3 text-xs font-medium"
              key={action.id}
              onClick={() => handleToggleAction(action.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              {action.actionLabel}
            </Button>
          );
        })}
      </div>
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
