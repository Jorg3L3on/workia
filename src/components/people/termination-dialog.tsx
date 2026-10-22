"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { FiniquitoFields } from "@/components/people/finiquito-fields";
import { CompanyField } from "@/components/tenant/company-context";
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
import { FormSelect } from "@/components/ui/form-select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { EmploymentActionState } from "@/lib/people/actions";
import {
  TERMINATION_TYPES,
  terminationTypeLabels,
} from "@/lib/people/employment-schema";
import { formatDateLabel } from "@/lib/people/schema";

export type EmploymentFormAction = (
  state: EmploymentActionState,
  formData: FormData,
) => Promise<EmploymentActionState>;

const initialState: EmploymentActionState = {};

const today = () => new Date().toISOString().slice(0, 10);

export const SubmitButton = ({
  label,
  variant = "primary",
}: {
  label: string;
  variant?: "primary" | "destructive";
}) => {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} type="submit" variant={variant}>
      {pending ? "Guardando…" : label}
    </Button>
  );
};

export const FieldError = ({
  id,
  message,
}: {
  id: string;
  message?: string;
}) =>
  message ? (
    <p className="text-destructive text-xs" id={id} role="alert">
      {message}
    </p>
  ) : null;

type TerminationDialogProps = {
  personName: string;
  action: EmploymentFormAction;
  reasons: { id: string; name: string }[];
  /** Ingreso of the open period: the baja cannot be earlier. */
  fechaIngreso: string | null;
  canSeeCompensation: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * «Dar de baja» (Iniciativa 2): fecha, tipo, motivo of the company's catalog,
 * comentario, recontratable and, optionally, the finiquito. The expediente
 * stays; its vigente contract becomes «Terminado» on the fecha de baja.
 */
export const TerminationDialog = ({
  personName,
  action,
  reasons,
  fechaIngreso,
  canSeeCompensation,
  open,
  onOpenChange,
}: TerminationDialogProps) => {
  const [state, formAction] = useActionState(action, initialState);
  const [withFiniquito, setWithFiniquito] = useState(false);
  const errors = state.fieldErrors ?? {};
  const generalError =
    state.error && Object.keys(errors).length === 0 ? state.error : null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Dar de baja a {personName}</DialogTitle>
          <DialogDescription>
            Deja de estar activa en las listas, altas y contratos; su contrato
            vigente queda «Terminado» en la fecha de baja. El expediente no se
            borra y puede reingresar después.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4" noValidate>
          <CompanyField />

          {generalError ? (
            <p className="text-destructive text-sm" role="alert">
              {generalError}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="baja-fecha">Fecha de baja</Label>
              <DateInput
                aria-describedby="baja-fecha-error"
                aria-invalid={Boolean(errors.fechaBaja)}
                defaultValue={today()}
                id="baja-fecha"
                name="fechaBaja"
                required
              />
              {fechaIngreso ? (
                <p className="text-muted-foreground text-xs">
                  Ingresó el {formatDateLabel(fechaIngreso)}.
                </p>
              ) : null}
              <FieldError id="baja-fecha-error" message={errors.fechaBaja} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="baja-tipo">Tipo de baja</Label>
              <FormSelect
                id="baja-tipo"
                name="tipoBaja"
                options={[
                  { value: "", label: "Elige el tipo" },
                  ...TERMINATION_TYPES.map((type) => ({
                    value: type,
                    label: terminationTypeLabels[type],
                  })),
                ]}
                required
                variant="field"
              />
              <FieldError id="baja-tipo-error" message={errors.tipoBaja} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="baja-motivo">Motivo</Label>
              <FormSelect
                id="baja-motivo"
                name="motivoBajaId"
                options={[
                  { value: "", label: "Elige el motivo" },
                  ...reasons.map((reason) => ({
                    value: reason.id,
                    label: reason.name,
                  })),
                ]}
                required
                variant="field"
              />
              <FieldError
                id="baja-motivo-error"
                message={errors.motivoBajaId}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="baja-comentario">
                Comentario{" "}
                <span className="text-muted-foreground font-normal">
                  (opcional)
                </span>
              </Label>
              <Textarea
                id="baja-comentario"
                maxLength={1000}
                name="comentario"
                placeholder="Contexto de la baja para RRHH"
              />
            </div>
          </div>

          <fieldset
            aria-describedby="baja-recontratable-error"
            className="space-y-2"
          >
            <legend className="mb-2 text-sm font-semibold">
              ¿Es recontratable?
            </legend>
            <div className="flex gap-6">
              {[
                { value: "si", label: "Sí" },
                { value: "no", label: "No" },
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    name="recontratable"
                    required
                    type="radio"
                    value={option.value}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <FieldError
              id="baja-recontratable-error"
              message={errors.recontratable}
            />
          </fieldset>

          <section className="space-y-3 border-t pt-4">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                checked={withFiniquito}
                onChange={(event) => setWithFiniquito(event.target.checked)}
                type="checkbox"
              />
              Capturar finiquito ahora
              <span className="text-muted-foreground font-normal">
                (se puede actualizar después)
              </span>
            </label>
            {withFiniquito ? (
              <FiniquitoFields
                canSeeAmount={canSeeCompensation}
                idPrefix="baja-finiquito-"
              />
            ) : null}
            <FieldError
              id="baja-finiquito-error"
              message={
                errors["finiquito.monto"] ??
                errors["finiquito.fecha"] ??
                errors["finiquito.estado"]
              }
            />
          </section>

          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
            <SubmitButton label="Dar de baja" variant="destructive" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
