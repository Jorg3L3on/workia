"use client";

import { useActionState, useState } from "react";

import {
  FieldError,
  SubmitButton,
  type EmploymentFormAction,
} from "@/components/people/termination-dialog";
import { CompanyField } from "@/components/tenant/company-context";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { EmploymentActionState } from "@/lib/people/actions";
import { formatDateLabel } from "@/lib/people/schema";

const initialState: EmploymentActionState = {};

type RehireDialogProps = {
  personName: string;
  action: EmploymentFormAction;
  /** The last baja: the new ingreso must be after it. */
  lastBaja: { fechaBaja: string | null; recontratable: boolean | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * «Reingresar» (Iniciativa 2): a new employment period in the same
 * expediente. HR decides whether the previous seniority counts (default no:
 * it restarts on the new ingreso); the history keeps the previous baja.
 */
export const RehireDialog = ({
  personName,
  action,
  lastBaja,
  open,
  onOpenChange,
}: RehireDialogProps) => {
  const [state, formAction] = useActionState(action, initialState);
  const [recognize, setRecognize] = useState(false);
  const errors = state.fieldErrors ?? {};
  const generalError =
    state.error && Object.keys(errors).length === 0 ? state.error : null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reingresar a {personName}</DialogTitle>
          <DialogDescription>
            Abre un nuevo periodo laboral en el mismo expediente y vuelve a
            estar activa. El historial conserva la baja anterior
            {lastBaja?.fechaBaja
              ? ` (${formatDateLabel(lastBaja.fechaBaja)})`
              : ""}
            .
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          <CompanyField />

          {lastBaja?.recontratable === false ? (
            <Alert role="status">
              <AlertDescription>
                En su baja anterior se marcó como no recontratable. Revisa la
                decisión antes de reingresarla.
              </AlertDescription>
            </Alert>
          ) : null}

          {generalError ? (
            <p className="text-destructive text-sm" role="alert">
              {generalError}
            </p>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="reingreso-fecha">Fecha de ingreso</Label>
            <DateInput
              aria-describedby="reingreso-fecha-error"
              aria-invalid={Boolean(errors.fechaIngreso)}
              id="reingreso-fecha"
              name="fechaIngreso"
              required
            />
            <FieldError
              id="reingreso-fecha-error"
              message={errors.fechaIngreso}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">
              Reconocer antigüedad previa
            </legend>
            <div className="flex gap-6">
              {[
                { value: false, label: "No (reinicia en el reingreso)" },
                { value: true, label: "Sí (acumula)" },
              ].map((option) => (
                <label
                  key={String(option.value)}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    checked={recognize === option.value}
                    name="reconoceAntiguedad"
                    onChange={() => setRecognize(option.value)}
                    type="radio"
                    value={option.value ? "si" : "no"}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          {recognize ? (
            <div className="space-y-1">
              <Label htmlFor="reingreso-antiguedad">
                Antigüedad desde{" "}
                <span className="text-muted-foreground font-normal">
                  (opcional; vacío = desde el primer ingreso)
                </span>
              </Label>
              <DateInput
                aria-describedby="reingreso-antiguedad-error"
                id="reingreso-antiguedad"
                name="fechaAntiguedadReconocida"
              />
              <FieldError
                id="reingreso-antiguedad-error"
                message={errors.fechaAntiguedadReconocida}
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
            <SubmitButton label="Reingresar" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
