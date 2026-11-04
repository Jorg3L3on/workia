"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  requestProfileCorrectionAction,
  type CorrectionFormState,
} from "@/lib/employee/correction-actions";
import { PROFILE_CORRECTION_LIMITS } from "@/lib/profile-corrections/labels";

/**
 * The correction request form of Mi expediente (W2-02): the proposed value
 * and an optional comment. The server works out «antes» and the person.
 */
export const CorrectionForm = ({
  field,
  label,
  hint,
}: {
  field: string;
  label: string;
  hint?: string;
}) => {
  const [state, action, pending] = useActionState<
    CorrectionFormState,
    FormData
  >(requestProfileCorrectionAction, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <input name="field" type="hidden" value={field} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="correction-value">Debe decir</Label>
        <Input
          aria-describedby={hint ? "correction-value-hint" : undefined}
          aria-invalid={Boolean(state.error)}
          autoComplete="off"
          defaultValue={state.proposedValue}
          id="correction-value"
          maxLength={PROFILE_CORRECTION_LIMITS.value}
          name="proposedValue"
          placeholder={label}
          required
        />
        {hint ? (
          <p
            className="text-muted-foreground text-xs"
            id="correction-value-hint"
          >
            {hint}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="correction-note">Comentario para RH (opcional)</Label>
        <Textarea
          defaultValue={state.note}
          id="correction-note"
          maxLength={PROFILE_CORRECTION_LIMITS.note}
          name="note"
          placeholder="Por ejemplo: así aparece en mi INE."
        />
      </div>
      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button disabled={pending} size="lg" type="submit">
        {pending ? "Enviando…" : "Enviar a RH"}
      </Button>
    </form>
  );
};
