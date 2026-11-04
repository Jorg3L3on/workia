"use client";

import { CheckIcon } from "lucide-react";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import {
  acceptResguardoAction,
  type AcceptResguardoState,
} from "@/lib/employee/resguardo-actions";

/** The "Acepto el resguardo" button of one entrega (W2-11). */
export const ResguardoAccept = ({
  movementId,
  assetName,
}: {
  movementId: string;
  assetName: string;
}) => {
  const [state, action, pending] = useActionState<
    AcceptResguardoState,
    FormData
  >(acceptResguardoAction, {});

  return (
    <form action={action} className="flex flex-col gap-2">
      <input name="movementId" type="hidden" value={movementId} />
      <Button
        aria-label={`Acepto el resguardo de ${assetName}`}
        disabled={pending}
        size="lg"
        type="submit"
      >
        <CheckIcon aria-hidden />
        {pending ? "Guardando…" : "Acepto el resguardo"}
      </Button>
      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
};
