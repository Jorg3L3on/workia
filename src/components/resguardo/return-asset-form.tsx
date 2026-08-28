"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  returnAssetAction,
  type ResguardoActionState,
} from "@/lib/resguardo/actions";

type ReturnAssetFormProps = {
  assetId: string;
  holderName: string;
};

const initialState: ResguardoActionState = {};

export const ReturnAssetForm = ({
  assetId,
  holderName,
}: ReturnAssetFormProps) => {
  const [state, formAction, pending] = useActionState(
    returnAssetAction,
    initialState,
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-4 border-t px-5 py-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Devolver activo</h3>
        <p className="text-muted-foreground text-sm">
          Registra la devolución de {holderName} con fecha y condición al
          recibir.
        </p>
      </div>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <input name="assetId" type="hidden" value={assetId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="movementDate">Fecha de devolución</Label>
          <Input
            defaultValue={today}
            id="movementDate"
            name="movementDate"
            required
            type="date"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="conditionNote">Condición al devolver</Label>
          <Input
            id="conditionNote"
            name="conditionNote"
            placeholder="Ej. Rayón leve en tapa"
            required
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="notes">Notas (opcional)</Label>
          <Textarea id="notes" name="notes" rows={2} />
        </div>
      </div>

      <Button disabled={pending} type="submit" variant="outline">
        {pending ? "Registrando…" : "Registrar devolución"}
      </Button>
    </form>
  );
};
