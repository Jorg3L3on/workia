"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormSelect } from "@/components/ui/form-select";
import { Label } from "@/components/ui/label";
import type { ContractTemplate } from "@/lib/db/schema";
import {
  renewContractAction,
  type ContractActionState,
} from "@/lib/contracts/actions";
import {
  contractNoticeWindowLabels,
  contractTypeLabels,
  formatContractDate,
} from "@/lib/contracts/schema";

type RenewContractDialogProps = {
  contractId: string;
  personName: string;
  endDate: string;
  templates: ContractTemplate[];
};

const initialState: ContractActionState = {};

const SubmitButton = () => {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} size="sm" type="submit" variant="outline">
      {pending ? "Renovando…" : "Renovar"}
    </Button>
  );
};

export const RenewContractForm = ({
  contractId,
  personName,
  endDate,
  templates,
}: RenewContractDialogProps) => {
  const [state, formAction] = useActionState(renewContractAction, initialState);

  const defaultStart = endDate;

  return (
    <form action={formAction} className="space-y-3 rounded-lg border p-4">
      <input name="contractId" type="hidden" value={contractId} />

      <div>
        <p className="font-medium">{personName}</p>
        <p className="text-muted-foreground text-xs">
          Vence {formatContractDate(endDate)}
        </p>
      </div>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`type-${contractId}`}>Nuevo tipo</Label>
          <FormSelect
            defaultValue="determinado"
            id={`type-${contractId}`}
            name="type"
            options={Object.entries(contractTypeLabels).map(
              ([value, label]) => ({
                value,
                label,
              }),
            )}
            variant="field"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={`notice-${contractId}`}>Aviso</Label>
          <FormSelect
            defaultValue="3"
            id={`notice-${contractId}`}
            name="noticeWindow"
            options={Object.entries(contractNoticeWindowLabels).map(
              ([value, label]) => ({ value, label }),
            )}
            variant="field"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={`start-${contractId}`}>Inicio</Label>
          <DateInput
            defaultValue={defaultStart}
            id={`start-${contractId}`}
            name="startDate"
            required
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={`end-${contractId}`}>Fin</Label>
          <DateInput id={`end-${contractId}`} name="endDate" />
        </div>

        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`template-${contractId}`}>Plantilla</Label>
          <FormSelect
            defaultValue={templates[0]?.id ?? ""}
            id={`template-${contractId}`}
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

      <SubmitButton />
    </form>
  );
};
