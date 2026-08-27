"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Person } from "@/lib/db/schema/people";
import {
  createPersonAction,
  updatePersonAction,
  type PersonActionState,
} from "@/lib/people/actions";
import {
  PERSON_STATUSES,
  personStatusLabels,
  type PersonFormValues,
} from "@/lib/people/schema";

type PersonFormProps = {
  mode: "create" | "edit";
  person?: Person;
};

const initialState: PersonActionState = {};

const SubmitButton = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();

  return (
    <Button
      className="workia-accent-gradient border-0 text-white shadow-md hover:opacity-95"
      disabled={pending}
      type="submit"
    >
      {pending ? "Guardando…" : label}
    </Button>
  );
};

export const PersonForm = ({ mode, person }: PersonFormProps) => {
  const action =
    mode === "create"
      ? createPersonAction
      : updatePersonAction.bind(null, person!.id);

  const [state, formAction] = useActionState(action, initialState);

  const defaultValues: PersonFormValues = {
    givenName: person?.givenName ?? "",
    familyName: person?.familyName ?? "",
    email: person?.email ?? "",
    status: person?.status ?? "activa",
  };

  return (
    <form action={formAction} className="workia-pass-card space-y-5 p-5 sm:p-6">
      <div className="space-y-1">
        <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          Expediente mínimo
        </p>
        <h2 className="text-lg font-semibold tracking-tight">
          {mode === "create" ? "Nueva persona" : "Editar persona"}
        </h2>
        <p className="text-muted-foreground text-sm">
          Datos para identificarla y ligar contratos o resguardo después.
        </p>
      </div>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="givenName">Nombre(s)</Label>
          <Input
            aria-invalid={Boolean(state.fieldErrors?.givenName)}
            defaultValue={defaultValues.givenName}
            id="givenName"
            name="givenName"
            placeholder="Ej. Persona"
            required
          />
          {state.fieldErrors?.givenName ? (
            <p className="text-destructive text-xs">
              {state.fieldErrors.givenName}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="familyName">Apellidos</Label>
          <Input
            aria-invalid={Boolean(state.fieldErrors?.familyName)}
            defaultValue={defaultValues.familyName}
            id="familyName"
            name="familyName"
            placeholder="Ej. Demo"
            required
          />
          {state.fieldErrors?.familyName ? (
            <p className="text-destructive text-xs">
              {state.fieldErrors.familyName}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Correo (opcional)</Label>
        <Input
          aria-invalid={Boolean(state.fieldErrors?.email)}
          defaultValue={defaultValues.email}
          id="email"
          name="email"
          placeholder="persona.demo@ejemplo.local"
          type="email"
        />
        {state.fieldErrors?.email ? (
          <p className="text-destructive text-xs">{state.fieldErrors.email}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="status">Relación laboral</Label>
        <select
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3 sm:w-60"
          defaultValue={defaultValues.status}
          id="status"
          name="status"
          required
        >
          {PERSON_STATUSES.map((status) => (
            <option key={status} value={status}>
              {personStatusLabels[status]}
            </option>
          ))}
        </select>
        {state.fieldErrors?.status ? (
          <p className="text-destructive text-xs">{state.fieldErrors.status}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <SubmitButton
          label={mode === "create" ? "Dar de alta" : "Guardar cambios"}
        />
        <Button asChild variant="outline">
          <Link
            href={
              mode === "create"
                ? "/app/personas"
                : `/app/personas/${person!.id}`
            }
          >
            Cancelar
          </Link>
        </Button>
        {mode === "edit" && person ? (
          <Badge variant={person.status === "activa" ? "default" : "secondary"}>
            {personStatusLabels[person.status]}
          </Badge>
        ) : null}
      </div>
    </form>
  );
};
