"use client";

import { useActionState } from "react";

import {
  FieldError,
  SubmitButton,
} from "@/components/people/termination-dialog";
import { CompanyField } from "@/components/tenant/company-context";
import { DateInput } from "@/components/ui/date-input";
import { FormSelect } from "@/components/ui/form-select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TransferActionState } from "@/lib/transfers/actions";

type Option = { id: string; name: string };

type TransferFormProps = {
  action: (
    state: TransferActionState,
    formData: FormData,
  ) => Promise<TransferActionState>;
  toCompanyId: string;
  toCompanyName: string;
  areas: Option[];
  positions: Option[];
  sites: Option[];
  defaultDate: string;
};

const FIELDS = new Set([
  "fechaTraslado",
  "areaId",
  "positionId",
  "siteId",
  "comentario",
]);

const initialState: TransferActionState = {};

const select = (options: Option[], empty: string) => [
  { value: "", label: empty },
  ...options.map((option) => ({ value: option.id, label: option.name })),
];

/**
 * The transfer form (W2-24): the first day in the new company and, from that
 * company's catalogs, área, puesto and sucursal. Personal data is copied
 * without re-capture; seniority carries over.
 */
export const TransferForm = ({
  action,
  toCompanyId,
  toCompanyName,
  areas,
  positions,
  sites,
  defaultDate,
}: TransferFormProps) => {
  const [state, formAction] = useActionState(action, initialState);
  const errors = state.fieldErrors ?? {};
  // A rule about the whole transfer (CURP, company) has no field here.
  const general =
    state.error ??
    Object.entries(errors).find(([field]) => !FIELDS.has(field))?.[1] ??
    null;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <CompanyField />
      <input name="toCompanyId" type="hidden" value={toCompanyId} />

      {general ? (
        <p className="text-destructive text-sm" role="alert">
          {general}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="traslado-fecha">Primer día en {toCompanyName}</Label>
          <DateInput
            aria-describedby="traslado-fecha-error"
            aria-invalid={Boolean(errors.fechaTraslado)}
            defaultValue={defaultDate}
            id="traslado-fecha"
            name="fechaTraslado"
            required
          />
          <FieldError
            id="traslado-fecha-error"
            message={errors.fechaTraslado}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="traslado-sucursal">Sucursal</Label>
          <FormSelect
            id="traslado-sucursal"
            name="siteId"
            options={select(sites, "Sin sucursal")}
            variant="field"
          />
          <FieldError id="traslado-sucursal-error" message={errors.siteId} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="traslado-area">Área</Label>
          <FormSelect
            id="traslado-area"
            name="areaId"
            options={select(areas, "Sin área")}
            variant="field"
          />
          <FieldError id="traslado-area-error" message={errors.areaId} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="traslado-puesto">Puesto</Label>
          <FormSelect
            id="traslado-puesto"
            name="positionId"
            options={select(positions, "Sin puesto")}
            variant="field"
          />
          <FieldError id="traslado-puesto-error" message={errors.positionId} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="traslado-comentario">
            Comentario{" "}
            <span className="text-muted-foreground font-normal">
              (opcional)
            </span>
          </Label>
          <Textarea
            id="traslado-comentario"
            maxLength={1000}
            name="comentario"
            placeholder="Motivo o contexto del traslado"
          />
          <FieldError
            id="traslado-comentario-error"
            message={errors.comentario}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <SubmitButton label={`Trasladar a ${toCompanyName}`} />
      </div>
    </form>
  );
};
