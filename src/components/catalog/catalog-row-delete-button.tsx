"use client";

import { useId } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type CatalogRowDeleteButtonProps = {
  action: () => void;
  itemLabel: string;
  itemName: string;
};

export const CatalogRowDeleteButton = ({
  action,
  itemLabel,
  itemName,
}: CatalogRowDeleteButtonProps) => {
  const formId = useId();

  const handleConfirmDelete = () => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    form?.requestSubmit();
  };

  return (
    <>
      <form action={action} className="hidden" id={formId} />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            aria-label={`Borrar ${itemLabel} ${itemName}`}
            size="sm"
            type="button"
            variant="ghost"
          >
            Borrar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar {itemLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se ocultará «{itemName}» del catálogo (borrado lógico). No podrás
              deshacerlo desde esta pantalla.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              variant="destructive"
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
