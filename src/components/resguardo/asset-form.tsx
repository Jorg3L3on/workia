"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createAssetAction,
  type ResguardoActionState,
} from "@/lib/resguardo/actions";
import { assetCategoryLabels } from "@/lib/resguardo/schema";

const initialState: ResguardoActionState = {};

export const AssetForm = () => {
  const [state, formAction, pending] = useActionState(
    createAssetAction,
    initialState,
  );

  return (
    <form action={formAction} className="workia-pass-card space-y-4 p-5 sm:p-6">
      <div className="space-y-1">
        <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          Resguardo
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Nuevo activo</h1>
        <p className="text-muted-foreground text-sm">
          Registra un activo identificable. Los de valor (moto, laptop) llevan
          historial; los consumibles no.
        </p>
      </div>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            name="name"
            placeholder="Ej. Laptop Dell Latitude 5540"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="identifier">Identificador</Label>
          <Input
            id="identifier"
            name="identifier"
            placeholder="Serie, placas o folio"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="category">Categoría</Label>
          <FormSelect
            defaultValue="laptop"
            id="category"
            name="category"
            options={Object.entries(assetCategoryLabels).map(
              ([value, label]) => ({
                value,
                label,
              }),
            )}
            required
            variant="field"
          />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <input
            className="border-input size-4 rounded"
            defaultChecked
            id="tracksHistory"
            name="tracksHistory"
            type="checkbox"
            value="true"
          />
          <Label htmlFor="tracksHistory">
            Registrar historial de entregas y devoluciones
          </Label>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 pt-2">
        <Button disabled={pending} type="submit">
          {pending ? "Guardando…" : "Registrar activo"}
        </Button>
        <Button asChild type="button" variant="ghost">
          <Link href="/app/resguardo">Cancelar</Link>
        </Button>
      </div>
    </form>
  );
};
