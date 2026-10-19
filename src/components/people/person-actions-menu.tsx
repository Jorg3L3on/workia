"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  FileSignatureIcon,
  FileTextIcon,
  RotateCcwIcon,
  Trash2Icon,
  UserCheckIcon,
  UserMinusIcon,
} from "lucide-react";

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
import { RowMenu } from "@/components/ui/data-table";
import type { PersonStatusValue } from "@/lib/people/schema";

type PersonActionsMenuProps = {
  personId: string;
  personName: string;
  status: PersonStatusValue;
  /** Bound server actions; absent when the user may not use them. */
  statusAction?: () => Promise<void>;
  deleteAction?: () => Promise<void>;
  showConstancia: boolean;
  /** «Iniciar alta» (RH → Nóminas) when the user may start one. */
  showStartAlta?: boolean;
  /** The header secondary, folded in below 768px. */
  emitContractHref?: string;
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

/**
 * The expediente's ⋯ menu: constancia, iniciar alta, baja or reactivation
 * (with its own dialog) and, last, the delete behind a confirmation.
 */
export const PersonActionsMenu = ({
  personId,
  personName,
  status,
  statusAction,
  deleteAction,
  showConstancia,
  showStartAlta = false,
  emitContractHref,
}: PersonActionsMenuProps) => {
  const [statusOpen, setStatusOpen] = useState(false);
  const isBaja = status === "baja";

  return (
    <>
      <RowMenu
        actions={[
          Boolean(emitContractHref) && {
            label: "Emitir contrato",
            icon: FileSignatureIcon,
            href: emitContractHref ?? "",
            mobileOnly: true,
          },
          showConstancia && {
            label: "Constancia de antigüedad",
            icon: FileTextIcon,
            href: `/app/personas/${personId}/constancia`,
          },
          showStartAlta && {
            label: "Iniciar alta",
            icon: UserCheckIcon,
            href: `/app/altas?persona=${personId}#iniciar-alta`,
          },
          statusAction && {
            label: isBaja ? "Reactivar" : "Dar de baja",
            icon: isBaja ? RotateCcwIcon : UserMinusIcon,
            onSelect: () => setStatusOpen(true),
          },
          deleteAction && {
            label: "Eliminar expediente",
            icon: Trash2Icon,
            action: deleteAction,
            destructive: true,
            confirm: {
              title: `Eliminar el expediente de ${personName}`,
              description:
                "Sale de las listas, altas y contratos. Nada se pierde: se puede consultar en Personas, entre los borrados, y cada cambio queda en Auditoría.",
              confirmLabel: "Eliminar",
            },
          },
        ]}
        label="Más acciones"
        size="icon"
        variant="secondary"
      />

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
    </>
  );
};
