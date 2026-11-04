"use client";

import { useActionState, useId } from "react";

import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  decideProfileCorrectionAction,
  type DecideCorrectionState,
} from "@/lib/profile-corrections/actions";
import { PROFILE_CORRECTION_LIMITS } from "@/lib/profile-corrections/labels";

/**
 * Closes one correction (W2-02): «Marcar como corregido» once the record was
 * fixed, or «Rechazar» with a reason the employee reads.
 */
export const CorrectionDecision = ({ id }: { id: string }) => {
  const reasonId = useId();
  const [state, action, pending] = useActionState<
    DecideCorrectionState,
    FormData
  >(decideProfileCorrectionAction, {});

  if (state.done) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Listo.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <CompanyField />
      <input name="id" type="hidden" value={id} />
      <Label className="workia-field-label" htmlFor={reasonId}>
        Motivo si la rechazas
      </Label>
      <Textarea
        className="min-h-12"
        id={reasonId}
        maxLength={PROFILE_CORRECTION_LIMITS.reason}
        name="reason"
        placeholder="La persona verá este motivo."
      />
      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          name="decision"
          type="submit"
          value="aplicada"
        >
          Marcar como corregido
        </Button>
        <Button
          disabled={pending}
          name="decision"
          type="submit"
          value="rechazada"
          variant="secondary"
        >
          Rechazar
        </Button>
      </div>
    </form>
  );
};
