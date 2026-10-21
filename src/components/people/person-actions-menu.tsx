"use client";

import { useState } from "react";
import {
  FileSignatureIcon,
  FileTextIcon,
  ReceiptTextIcon,
  RotateCcwIcon,
  Trash2Icon,
  UserCheckIcon,
  UserMinusIcon,
} from "lucide-react";

import { FiniquitoDialog } from "@/components/people/finiquito-dialog";
import { RehireDialog } from "@/components/people/rehire-dialog";
import {
  TerminationDialog,
  type EmploymentFormAction,
} from "@/components/people/termination-dialog";
import { RowMenu } from "@/components/ui/data-table";
import type { PersonStatusValue } from "@/lib/people/schema";

/** What the baja, reingreso and finiquito dialogs need (Iniciativa 2). */
export type PersonEmploymentMenuData = {
  /** Active motivos de baja of the company. */
  reasons: { id: string; name: string }[];
  /** Ingreso of the open period, or of the last one. */
  fechaIngreso: string | null;
  /** The last closed period, if any: for «Reingresar» and «Finiquito». */
  lastBaja: {
    fechaBaja: string | null;
    recontratable: boolean | null;
    finiquitoEstado: string | null;
    finiquitoFecha: string | null;
    /** Null unless the viewer has compensation:read. */
    finiquitoMonto: string | null;
    hasFiniquitoMonto: boolean;
  } | null;
  canSeeCompensation: boolean;
};

type PersonActionsMenuProps = {
  personId: string;
  personName: string;
  status: PersonStatusValue;
  /** Bound server actions; absent when the user may not use them. */
  statusAction?: EmploymentFormAction;
  finiquitoAction?: EmploymentFormAction;
  employment?: PersonEmploymentMenuData;
  deleteAction?: () => Promise<void>;
  showConstancia: boolean;
  /** «Iniciar alta» (RH → Nóminas) when the user may start one. */
  showStartAlta?: boolean;
  /** The header secondary, folded in below 768px. */
  emitContractHref?: string;
};

/**
 * The expediente's ⋯ menu: constancia, iniciar alta, «Dar de baja» or
 * «Reingresar» and «Finiquito» (each with its own dialog) and, last, the
 * delete behind a confirmation.
 */
export const PersonActionsMenu = ({
  personId,
  personName,
  status,
  statusAction,
  finiquitoAction,
  employment,
  deleteAction,
  showConstancia,
  showStartAlta = false,
  emitContractHref,
}: PersonActionsMenuProps) => {
  const [statusOpen, setStatusOpen] = useState(false);
  const [finiquitoOpen, setFiniquitoOpen] = useState(false);
  const isBaja = status === "baja";
  const lastBaja = employment?.lastBaja ?? null;

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
          statusAction &&
            employment && {
              label: isBaja ? "Reingresar" : "Dar de baja",
              icon: isBaja ? RotateCcwIcon : UserMinusIcon,
              onSelect: () => setStatusOpen(true),
            },
          finiquitoAction &&
            lastBaja && {
              label: "Finiquito",
              icon: ReceiptTextIcon,
              onSelect: () => setFiniquitoOpen(true),
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

      {statusAction && employment && !isBaja ? (
        <TerminationDialog
          action={statusAction}
          canSeeCompensation={employment.canSeeCompensation}
          fechaIngreso={employment.fechaIngreso}
          onOpenChange={setStatusOpen}
          open={statusOpen}
          personName={personName}
          reasons={employment.reasons}
        />
      ) : null}

      {statusAction && employment && isBaja ? (
        <RehireDialog
          action={statusAction}
          lastBaja={lastBaja}
          onOpenChange={setStatusOpen}
          open={statusOpen}
          personName={personName}
        />
      ) : null}

      {finiquitoAction && employment && lastBaja ? (
        <FiniquitoDialog
          action={finiquitoAction}
          canSeeCompensation={employment.canSeeCompensation}
          fechaBaja={lastBaja.fechaBaja}
          hasAmount={lastBaja.hasFiniquitoMonto}
          initial={{
            estado: lastBaja.finiquitoEstado,
            fecha: lastBaja.finiquitoFecha,
            monto: lastBaja.finiquitoMonto,
          }}
          onOpenChange={setFiniquitoOpen}
          open={finiquitoOpen}
          personName={personName}
        />
      ) : null}
    </>
  );
};
