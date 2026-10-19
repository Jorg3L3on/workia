"use client";

import { Trash2Icon } from "lucide-react";
import { useTransition, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { RowMenuAction } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** «Borrar» in a catalog row menu: last, red, confirmed. */
export const catalogDeleteAction = (
  action: () => void | Promise<void>,
  itemLabel: string,
  itemName: string,
): RowMenuAction => ({
  label: "Borrar",
  icon: Trash2Icon,
  destructive: true,
  action,
  confirm: {
    title: `¿Borrar ${itemLabel}?`,
    description: `Se ocultará «${itemName}» del catálogo. No podrás deshacerlo desde esta pantalla.`,
    confirmLabel: "Borrar",
  },
});

type CatalogEditDialogProps = {
  title: string;
  description?: ReactNode;
  /** A bound server action; the dialog closes once it finishes. */
  action: (formData: FormData) => void | Promise<void>;
  onClose: () => void;
  children: ReactNode;
};

/** A small edit of one catalog row (región, nombre) out of the table cell. */
export const CatalogEditDialog = ({
  title,
  description,
  action,
  onClose,
  children,
}: CatalogEditDialogProps) => {
  const [pending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      await action(formData);
      onClose();
    });
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      open
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          {children}
          <DialogFooter>
            <Button onClick={onClose} type="button" variant="secondary">
              Cancelar
            </Button>
            <Button disabled={pending} type="submit">
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
