"use client";

import { DateInput } from "@/components/ui/date-input";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FINIQUITO_STATUSES,
  finiquitoStatusLabels,
  MASKED_AMOUNT,
} from "@/lib/people/employment-schema";

export type FiniquitoDefaults = {
  estado: string | null;
  fecha: string | null;
  /** Null without compensation:read: the field shows «•••» and is not sent. */
  monto: string | null;
};

/**
 * Estado, fecha and monto of a finiquito (Iniciativa 2). The amount is payroll
 * data: without compensation:read it reads «•••» and is never posted, so the
 * stored one stays as it is.
 */
export const FiniquitoFields = ({
  idPrefix,
  initial,
  canSeeAmount,
  hasAmount = false,
}: {
  idPrefix: string;
  initial?: FiniquitoDefaults | null;
  canSeeAmount: boolean;
  /** An amount is stored (shown masked to who cannot see it). */
  hasAmount?: boolean;
}) => (
  <div className="grid gap-3 sm:grid-cols-3">
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}estado`}>Estado</Label>
      <FormSelect
        defaultValue={initial?.estado ?? ""}
        id={`${idPrefix}estado`}
        name="finiquitoEstado"
        options={[
          { value: "", label: "Sin capturar" },
          ...FINIQUITO_STATUSES.map((status) => ({
            value: status,
            label: finiquitoStatusLabels[status],
          })),
        ]}
        variant="field"
      />
    </div>
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}fecha`}>Fecha</Label>
      <DateInput
        defaultValue={initial?.fecha ?? ""}
        id={`${idPrefix}fecha`}
        name="finiquitoFecha"
      />
    </div>
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}monto`}>Monto (MXN)</Label>
      {canSeeAmount ? (
        <Input
          defaultValue={
            initial?.monto ? String(Number(initial.monto)) : undefined
          }
          id={`${idPrefix}monto`}
          inputMode="decimal"
          min={0}
          name="finiquitoMonto"
          step="0.01"
          type="number"
        />
      ) : (
        <Input
          aria-describedby={`${idPrefix}monto-help`}
          disabled
          id={`${idPrefix}monto`}
          readOnly
          value={hasAmount ? MASKED_AMOUNT : ""}
        />
      )}
      {canSeeAmount ? null : (
        <p
          className="text-muted-foreground text-xs"
          id={`${idPrefix}monto-help`}
        >
          Solo quien ve nómina captura el monto.
        </p>
      )}
    </div>
  </div>
);
