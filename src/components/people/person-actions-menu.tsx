"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { EllipsisIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import type { PersonStatusValue } from "@/lib/people/schema";

type PersonActionsMenuProps = {
  personId: string;
  personName: string;
  status: PersonStatusValue;
  /** Bound server actions; absent when the user may not use them. */
  statusAction?: () => Promise<void>;
  deleteAction?: () => Promise<void>;
  showConstancia: boolean;
};

const ConfirmButton = ({
  label,
  variant,
}: {
  label: string;
  variant: "primary" | "destructive";
}) => {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} type="submit" variant={variant}>
      {pending ? "Guardando…" : label}
    </Button>
  );
};

/** The expediente's ⋯ menu: constancia, baja or reactivation, and the delete. */
export const PersonActionsMenu = ({
  personId,
  personName,
  status,
  statusAction,
  deleteAction,
  showConstancia,
}: PersonActionsMenuProps) => {
  const [statusOpen, setStatusOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isBaja = status === "baja";

  if (!showConstancia && !statusAction && !deleteAction) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label="Más acciones" variant="secondary">
            <EllipsisIcon aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {showConstancia ? (
            <DropdownMenuItem asChild>
              <Link href={`/app/personas/${personId}/constancia`}>
                Constancia de antigüedad
              </Link>
            </DropdownMenuItem>
          ) : null}
          {statusAction || deleteAction ? (
            <>
              {showConstancia ? <DropdownMenuSeparator /> : null}
              {statusAction ? (
                <DropdownMenuItem onSelect={() => setStatusOpen(true)}>
                  {isBaja ? "Reactivar" : "Dar de baja"}
                </DropdownMenuItem>
              ) : null}
              {deleteAction ? (
                <DropdownMenuItem
                  onSelect={() => setDeleteOpen(true)}
                  variant="destructive"
                >
                  Eliminar expediente
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {statusAction ? (
        <AlertDialog onOpenChange={setStatusOpen} open={statusOpen}>
          <AlertDialogContent>
            <form action={statusAction} className="contents">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {isBaja
                    ? `Reactivar a ${personName}`
                    : `Dar de baja a ${personName}`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isBaja
                    ? "Vuelve a estar activa en las listas, altas y contratos."
                    : "Deja de estar activa en las listas, altas y contratos. El expediente no se borra: sus datos, contratos e historial siguen disponibles, y borrarlo es una acción aparte."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
                <ConfirmButton
                  label={isBaja ? "Reactivar" : "Dar de baja"}
                  variant={isBaja ? "primary" : "destructive"}
                />
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {deleteAction ? (
        <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
          <AlertDialogContent>
            <form action={deleteAction} className="contents">
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Eliminar el expediente de {personName}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Sale de las listas, altas y contratos. Nada se pierde: se
                  puede consultar en Personas, entre los borrados, y cada cambio
                  queda en Auditoría.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
                <ConfirmButton label="Eliminar" variant="destructive" />
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
};
