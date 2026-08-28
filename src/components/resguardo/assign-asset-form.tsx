"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  assignAssetAction,
  type ResguardoActionState,
} from "@/lib/resguardo/actions";

type AssignAssetFormProps = {
  assetId: string;
  people: Array<{ id: string; label: string }>;
};

const initialState: ResguardoActionState = {};

export const AssignAssetForm = ({ assetId, people }: AssignAssetFormProps) => {
  const [state, formAction, pending] = useActionState(
    assignAssetAction,
    initialState,
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="space-y-4 border-t px-5 py-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Entregar activo</h3>
        <p className="text-muted-foreground text-sm">
          Asigna el activo a una persona con fecha y condición al recibir.
        </p>
      </div>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <input name="assetId" type="hidden" value={assetId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="personId">Persona</Label>
          <select
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
            id="personId"
            name="personId"
            required
          >
            <option value="">Selecciona una persona</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="movementDate">Fecha de entrega</Label>
          <Input
            defaultValue={today}
            id="movementDate"
            name="movementDate"
            required
            type="date"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="conditionNote">Condición al entregar</Label>
          <Input
            id="conditionNote"
            name="conditionNote"
            placeholder="Ej. Buen estado, sin rayones"
            required
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="notes">Notas (opcional)</Label>
          <Textarea id="notes" name="notes" rows={2} />
        </div>
      </div>

      <Button disabled={pending} type="submit">
        {pending ? "Registrando…" : "Registrar entrega"}
      </Button>
    </form>
  );
};
