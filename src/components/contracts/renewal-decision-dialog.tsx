"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  CompensationFields,
  type CompensationDefaults,
} from "@/components/contracts/compensation-fields";
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
import {
  decideContractRenewalAction,
  type ContractActionState,
} from "@/lib/contracts/actions";
import {
  contractNoticeWindowLabels,
  formatContractDate,
  RENEWAL_DECISIONS,
  renewalDecisionLabels,
  type RenewalDecision,
} from "@/lib/contracts/schema";
import type { ContractTemplate } from "@/lib/db/schema";

type RenewalDecisionDialogProps = {
  contractId: string;
  personName: string;
  endDate: string;
  templates: ContractTemplate[];
  positions: { id: string; name: string }[];
  canSeeCompensation?: boolean;
  compensation?: CompensationDefaults;
  /** Opened from the tray row (inline action or ⋯ menu). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const initialState: ContractActionState = {};

const SubmitButton = ({ decision }: { decision: RenewalDecision }) => {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} type="submit">
      {pending
        ? "Guardando…"
        : decision === "no_renovar"
          ? "Registrar no renovación"
          : "Renovar"}
    </Button>
  );
};

/**
 * The tray's renewal decision in one step (WRK-I5-6): renew open-ended or
 * fixed-term (optionally with a new position and compensation), or not renew
 * with a reason. The hire date never changes.
 */
export const RenewalDecisionDialog = ({
  contractId,
  personName,
  endDate,
  templates,
  positions,
  canSeeCompensation = false,
  compensation,
  open,
  onOpenChange,
}: RenewalDecisionDialogProps) => {
  const [state, formAction] = useActionState(
    decideContractRenewalAction,
    initialState,
  );
  const [decision, setDecision] = useState<RenewalDecision>(
    "renovar_determinado",
  );
  const renewing = decision !== "no_renovar";
  const id = (name: string) => `decide-${contractId}-${name}`;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Decidir renovación</DialogTitle>
          <DialogDescription>
            {personName} · vence {formatContractDate(endDate)}. La fecha de
            ingreso no cambia.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <CompanyField />
          <input name="contractId" type="hidden" value={contractId} />
          <input name="decision" type="hidden" value={decision} />

          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Decisión</legend>
            {RENEWAL_DECISIONS.map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  checked={decision === option}
                  name="decision-choice"
                  onChange={() => setDecision(option)}
                  type="radio"
                  value={option}
                />
                {renewalDecisionLabels[option]}
              </label>
            ))}
          </fieldset>

          {state.error ? (
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
          ) : null}

          {renewing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor={id("template")}>Plantilla</Label>
                <FormSelect
                  defaultValue={templates[0]?.id ?? ""}
                  id={id("template")}
                  name="templateId"
                  options={templates.map((template) => ({
                    value: template.id,
                    label: template.name,
                  }))}
                  variant="field"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={id("start")}>Inicio</Label>
                <DateInput
                  defaultValue={endDate}
                  id={id("start")}
                  name="startDate"
                  required
                />
              </div>
              {decision === "renovar_determinado" ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor={id("end")}>Fin</Label>
                    <DateInput id={id("end")} name="endDate" required />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={id("notice")}>Aviso</Label>
                    <FormSelect
                      defaultValue="1"
                      id={id("notice")}
                      name="noticeWindow"
                      options={Object.entries(contractNoticeWindowLabels).map(
                        ([value, label]) => ({ value, label }),
                      )}
                      variant="field"
                    />
                  </div>
                </>
              ) : null}
              <div className="space-y-1">
                <Label htmlFor={id("position")}>Puesto</Label>
                <FormSelect
                  defaultValue=""
                  id={id("position")}
                  name="newPositionId"
                  options={[
                    { value: "", label: "Mismo puesto" },
                    ...positions.map((position) => ({
                      value: position.id,
                      label: position.name,
                    })),
                  ]}
                  variant="field"
                />
              </div>
              {canSeeCompensation ? (
                <div className="sm:col-span-2">
                  <CompensationFields
                    idPrefix={id("comp-")}
                    initial={compensation}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor={id("motivo")}>Motivo</Label>
              <Textarea
                id={id("motivo")}
                maxLength={500}
                name="motivo"
                placeholder="Ej. Evaluación no aprobada, fin del proyecto…"
                required
              />
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
            <SubmitButton decision={decision} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
