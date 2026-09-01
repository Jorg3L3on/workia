"use client";

import { useActionState, useMemo } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormSelect } from "@/components/ui/form-select";
import { Label } from "@/components/ui/label";
import type { ContractTemplate } from "@/lib/db/schema";
import {
  createContractAction,
  type ContractActionState,
} from "@/lib/contracts/actions";
import {
  contractNoticeWindowLabels,
  contractTypeLabels,
  fillContractTemplate,
} from "@/lib/contracts/schema";
import { isoToday } from "@/lib/format/date";

type ContractFormProps = {
  personId: string;
  personContext: {
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno?: string | null;
    puesto?: string | null;
    area?: string | null;
    sucursal?: string | null;
    rfc?: string | null;
    horario?: string | null;
  };
  templates: ContractTemplate[];
};

const initialState: ContractActionState = {};

const SubmitButton = () => {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} type="submit">
      {pending ? "Emitiendo…" : "Emitir contrato"}
    </Button>
  );
};

export const ContractForm = ({
  personId,
  personContext,
  templates,
}: ContractFormProps) => {
  const [state, formAction] = useActionState(
    createContractAction,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input name="personId" type="hidden" value={personId} />

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="type">Tipo de contrato</Label>
          <FormSelect
            defaultValue="determinado"
            id="type"
            name="type"
            options={Object.entries(contractTypeLabels).map(
              ([value, label]) => ({
                value,
                label,
              }),
            )}
            required
            variant="field"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="noticeWindow">Ventana de aviso</Label>
          <FormSelect
            defaultValue="3"
            id="noticeWindow"
            name="noticeWindow"
            options={Object.entries(contractNoticeWindowLabels).map(
              ([value, label]) => ({ value, label }),
            )}
            required
            variant="field"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="startDate">Fecha de inicio</Label>
          <DateInput id="startDate" name="startDate" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="endDate">Fecha de fin (determinado)</Label>
          <DateInput id="endDate" name="endDate" />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="templateId">Plantilla</Label>
          <FormSelect
            defaultValue={templates[0]?.id ?? ""}
            id="templateId"
            name="templateId"
            options={templates.map((template) => ({
              value: template.id,
              label: template.name,
            }))}
            required
            variant="field"
          />
        </div>
      </div>

      <ContractPreview templates={templates} personContext={personContext} />

      <SubmitButton />
    </form>
  );
};

const ContractPreview = ({
  templates,
  personContext,
}: Pick<ContractFormProps, "templates" | "personContext">) => {
  const preview = useMemo(() => {
    const template = templates[0];

    if (!template) {
      return "Selecciona una plantilla para ver la vista previa.";
    }

    return fillContractTemplate(template.body, {
      ...personContext,
      fechaInicio: isoToday(),
      fechaFin: null,
    });
  }, [templates, personContext]);

  return (
    <div className="space-y-2">
      <Label>Vista previa del texto generado</Label>
      <pre className="bg-muted max-h-48 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
        {preview}
      </pre>
    </div>
  );
};
