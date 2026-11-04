"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createRequestAction } from "@/lib/employee/request-actions";
import { TIME_OFF_KIND_LABELS, TIME_OFF_KINDS } from "@/lib/requests/rules";

import { ActionMessage } from "./action-message";

/**
 * «Pedir vacaciones o permiso» in /mi/solicitudes/nueva (W2-06). The
 * person is the session's; the form only says what and when.
 */
export const RequestForm = ({ today }: { today: string }) => {
  const [state, action, pending] = useActionState(createRequestAction, {});

  return (
    <form action={action} className="space-y-4" data-testid="request-form">
      <div className="space-y-1.5">
        <Label htmlFor="request-kind">Qué pides</Label>
        <FormSelect
          aria-label="Qué pides"
          defaultValue="vacaciones"
          id="request-kind"
          name="kind"
          options={TIME_OFF_KINDS.map((kind) => ({
            value: kind,
            label: TIME_OFF_KIND_LABELS[kind],
          }))}
          variant="field"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="request-start">Primer día</Label>
          <DateInput
            defaultValue={today}
            id="request-start"
            name="startDate"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="request-end">Último día</Label>
          <DateInput id="request-end" name="endDate" required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="request-days">Días que faltarás</Label>
        <Input
          id="request-days"
          inputMode="decimal"
          name="days"
          placeholder="Por ejemplo 3 o 0.5"
          required
        />
        <p className="text-muted-foreground text-xs">
          Cuenta solo los días que te toca trabajar. Puedes pedir medios días.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="request-note">Nota para tu jefe (opcional)</Label>
        <Textarea id="request-note" maxLength={280} name="note" rows={3} />
        <p className="text-muted-foreground text-xs">
          No escribas datos de salud: si es por incapacidad, entrégala a RH.
        </p>
      </div>
      <Button className="w-full" disabled={pending} size="lg" type="submit">
        {pending ? "Enviando…" : "Enviar solicitud"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
};
