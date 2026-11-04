"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormSelect } from "@/components/ui/form-select";
import { Label } from "@/components/ui/label";
import {
  cancelDelegationAction,
  createDelegationAction,
  type DelegationActionState,
} from "@/lib/employee/manager-actions";
import { formatDateMx } from "@/lib/format/date";
import type { DelegateCandidate, DelegationView } from "@/lib/managers";

const Message = ({ state }: { state: DelegationActionState }) =>
  state.error ? (
    <p className="text-destructive text-sm" role="alert">
      {state.error}
    </p>
  ) : state.notice ? (
    <p
      className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
      role="status"
    >
      {state.notice}
    </p>
  ) : null;

const CancelDelegation = ({ delegation }: { delegation: DelegationView }) => {
  const [state, action, pending] = useActionState(cancelDelegationAction, {});

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <span className="text-sm">
        <span className="font-medium">{delegation.delegateName}</span>, del{" "}
        {formatDateMx(delegation.startsOn)} al {formatDateMx(delegation.endsOn)}
      </span>
      <form action={action}>
        <input name="delegationId" type="hidden" value={delegation.id} />
        <Button disabled={pending} size="sm" type="submit" variant="ghost">
          Terminar
        </Button>
      </form>
      <Message state={state} />
    </li>
  );
};

/** The manager's backup in /mi/equipo (W2-07): who covers, and until when. */
export const DelegationControls = ({
  candidates,
  delegations,
  today,
}: {
  candidates: DelegateCandidate[];
  delegations: DelegationView[];
  today: string;
}) => {
  const [state, action, pending] = useActionState(createDelegationAction, {});

  return (
    <div className="space-y-3" data-testid="delegation-controls">
      {delegations.length > 0 ? (
        <ul className="divide-y">
          {delegations.map((delegation) => (
            <CancelDelegation delegation={delegation} key={delegation.id} />
          ))}
        </ul>
      ) : null}

      {candidates.length > 0 ? (
        <form action={action} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="delegate">Suplente</Label>
            <FormSelect
              aria-label="Suplente"
              id="delegate"
              name="delegateAccountId"
              options={candidates.map((candidate) => ({
                value: candidate.accountId,
                label: candidate.name,
              }))}
              placeholder="Elige a una persona"
              variant="field"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="delegation-starts">Desde</Label>
              <DateInput
                defaultValue={today}
                id="delegation-starts"
                name="startsOn"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delegation-ends">Hasta</Label>
              <DateInput id="delegation-ends" name="endsOn" required />
            </div>
          </div>
          <Button disabled={pending} size="lg" type="submit">
            Guardar suplente
          </Button>
          <Message state={state} />
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">
          Para nombrar suplente, la persona necesita cuenta en la app y ser tu
          reporte directo o tener rol de jefe.
        </p>
      )}
    </div>
  );
};
