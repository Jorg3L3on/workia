"use client";

import { useRef } from "react";

import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  INCIDENCIAS_COPY,
  justificationKindLabel,
} from "@/lib/incidencias/copy";

import { useIncidenciaAction, type IncidenciaAction } from "./use-action";

const KINDS = [
  "permiso_con_goce",
  "permiso_sin_goce",
  "incapacidad_imss",
] as const;

/** Registers a permiso or an IMSS incapacidad over a range of days. */
export const JustificationForm = ({
  personId,
  defaultDay,
  action,
}: {
  personId: string;
  defaultDay: string;
  action: IncidenciaAction;
}) => {
  const form = useRef<HTMLFormElement>(null);
  const { pending, error, handleSubmit } = useIncidenciaAction(action, () =>
    form.current?.reset(),
  );

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      data-testid="justification-form"
      onSubmit={handleSubmit}
      ref={form}
    >
      <CompanyField />
      <input name="personId" type="hidden" value={personId} />
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="justification-kind">{INCIDENCIAS_COPY.kindLabel}</Label>
        <FormSelect
          defaultValue="permiso_con_goce"
          id="justification-kind"
          name="kind"
          options={KINDS.map((kind) => ({
            value: kind,
            label: justificationKindLabel[kind],
          }))}
          required
          variant="field"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="justification-from">{INCIDENCIAS_COPY.fromLabel}</Label>
        <DateInput
          defaultValue={defaultDay}
          id="justification-from"
          name="fromDay"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="justification-to">{INCIDENCIAS_COPY.toLabel}</Label>
        <DateInput
          defaultValue={defaultDay}
          id="justification-to"
          name="toDay"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="justification-reason">
          {INCIDENCIAS_COPY.reasonLabel}
        </Label>
        <Textarea
          id="justification-reason"
          maxLength={280}
          name="reason"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor="justification-reference">
          {INCIDENCIAS_COPY.referenceLabel}
        </Label>
        <Input id="justification-reference" maxLength={80} name="reference" />
      </div>
      {error ? (
        <p className="text-destructive text-sm sm:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button
          aria-busy={pending}
          disabled={pending}
          type="submit"
          variant="primary"
        >
          {pending ? "Guardando…" : INCIDENCIAS_COPY.addJustification}
        </Button>
      </div>
    </form>
  );
};
