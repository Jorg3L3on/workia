"use client";

import { useState } from "react";

import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  monthlySalary,
  PAY_FREQUENCIES,
  PAYMENT_METHODS,
  payFrequencyLabels,
  paymentMethodLabels,
} from "@/lib/contracts/schema";

const money = (value: number) =>
  value.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

export type CompensationDefaults = {
  salarioDiario: string | null;
  formaPago: string | null;
  periodicidadPago: string | null;
  diaPago: string | null;
};

/**
 * Salary and payment terms of a contract (WRK-I5-2); frozen when it is issued.
 * A renewal starts from the previous contract's, so leaving them as they are
 * keeps them.
 */
export const CompensationFields = ({
  idPrefix = "",
  initial,
}: {
  idPrefix?: string;
  initial?: CompensationDefaults | null;
}) => {
  const [daily, setDaily] = useState(
    initial?.salarioDiario ? String(Number(initial.salarioDiario)) : "",
  );
  const amount = Number(daily);

  return (
    <section
      aria-labelledby={`${idPrefix}compensation-heading`}
      className="space-y-3 border-t pt-4"
      data-testid="compensation-fields"
    >
      <h3
        className="text-sm font-semibold"
        id={`${idPrefix}compensation-heading`}
      >
        Compensación{" "}
        <span className="text-muted-foreground font-normal">(opcional)</span>
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}salarioDiario`}>
            Salario diario (MXN)
          </Label>
          <Input
            id={`${idPrefix}salarioDiario`}
            inputMode="decimal"
            min={0.01}
            name="salarioDiario"
            onChange={(event) => setDaily(event.target.value)}
            step="0.01"
            type="number"
            value={daily}
          />
          {amount > 0 ? (
            <p className="text-muted-foreground text-xs">
              Mensual: {money(monthlySalary(amount))} (diario × 30.4)
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}diaPago`}>Día de pago (opcional)</Label>
          <Input
            id={`${idPrefix}diaPago`}
            name="diaPago"
            defaultValue={initial?.diaPago ?? ""}
            placeholder="Viernes, 15 y último…"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}formaPago`}>Forma de pago</Label>
          <FormSelect
            defaultValue={initial?.formaPago ?? ""}
            id={`${idPrefix}formaPago`}
            name="formaPago"
            options={[
              { value: "", label: "Sin capturar" },
              ...PAYMENT_METHODS.map((value) => ({
                value,
                label: paymentMethodLabels[value],
              })),
            ]}
            variant="field"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}periodicidadPago`}>Periodicidad</Label>
          <FormSelect
            defaultValue={initial?.periodicidadPago ?? ""}
            id={`${idPrefix}periodicidadPago`}
            name="periodicidadPago"
            options={[
              { value: "", label: "Sin capturar" },
              ...PAY_FREQUENCIES.map((value) => ({
                value,
                label: payFrequencyLabels[value],
              })),
            ]}
            variant="field"
          />
        </div>
      </div>
    </section>
  );
};

export const formatMoney = money;
