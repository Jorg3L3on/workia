"use client";

import { useActionState } from "react";

import {
  FiniquitoFields,
  type FiniquitoDefaults,
} from "@/components/people/finiquito-fields";
import {
  SubmitButton,
  type EmploymentFormAction,
} from "@/components/people/termination-dialog";
import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EmploymentActionState } from "@/lib/people/actions";
import { formatDateLabel } from "@/lib/people/schema";

const initialState: EmploymentActionState = {};

type FiniquitoDialogProps = {
  personName: string;
  action: EmploymentFormAction;
  fechaBaja: string | null;
  initial: FiniquitoDefaults;
  /** A stored amount, even when this viewer may not see it. */
  hasAmount: boolean;
  canSeeCompensation: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** «Finiquito» of the last baja: estado, fecha and (with compensation:read) monto. */
export const FiniquitoDialog = ({
  personName,
  action,
  fechaBaja,
  initial,
  hasAmount,
  canSeeCompensation,
  open,
  onOpenChange,
}: FiniquitoDialogProps) => {
  const [state, formAction] = useActionState(action, initialState);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Finiquito de {personName}</DialogTitle>
          <DialogDescription>
            {fechaBaja
              ? `Baja del ${formatDateLabel(fechaBaja)}. `
              : "Baja sin fecha registrada. "}
            Cada cambio queda en el historial.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <CompanyField />
          {state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}
          <FiniquitoFields
            canSeeAmount={canSeeCompensation}
            hasAmount={hasAmount}
            idPrefix="finiquito-"
            initial={initial}
          />
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
            <SubmitButton label="Guardar finiquito" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
