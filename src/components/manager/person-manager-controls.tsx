"use client";

import { useActionState } from "react";

import { CompanyField } from "@/components/tenant/company-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatDateMx } from "@/lib/format/date";
import {
  cancelDelegationByHrAction,
  revokeManagerGrantAction,
  setManagerGrantAction,
  type ManagerAdminActionState,
} from "@/lib/managers/actions";

/** «Rol de jefe» as the expediente passes it to the client (W2-07). */
export type PersonManagerView = {
  grant: { includeIndirect: boolean } | null;
  directReports: number;
  delegations: Array<{
    id: string;
    delegateName: string;
    startsOn: string;
    endsOn: string;
  }>;
};

const Message = ({ state }: { state: ManagerAdminActionState }) =>
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

const EndDelegation = ({
  personId,
  delegation,
}: {
  personId: string;
  delegation: PersonManagerView["delegations"][number];
}) => {
  const [state, action, pending] = useActionState(
    cancelDelegationByHrAction,
    {},
  );

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span>
        Suplente: <span className="font-medium">{delegation.delegateName}</span>
        , del {formatDateMx(delegation.startsOn)} al{" "}
        {formatDateMx(delegation.endsOn)}
      </span>
      <form action={action}>
        <CompanyField />
        <input name="personId" type="hidden" value={personId} />
        <input name="delegationId" type="hidden" value={delegation.id} />
        <Button disabled={pending} size="sm" type="submit" variant="ghost">
          Terminar
        </Button>
      </form>
      <Message state={state} />
    </li>
  );
};

/**
 * «Rol de jefe» under the employee account (W2-07): whether the person sees
 * their team in the app, with or without indirect reports, and the backups
 * they named. The team itself is whoever has them as jefe in the expediente.
 */
export const PersonManagerControls = ({
  personId,
  view,
}: {
  personId: string;
  view: PersonManagerView;
}) => {
  const [saveState, saveAction, saving] = useActionState(
    setManagerGrantAction,
    {},
  );
  const [revokeState, revokeAction, revoking] = useActionState(
    revokeManagerGrantAction,
    {},
  );
  const { grant } = view;

  return (
    <div className="space-y-3 border-t pt-4" data-testid="manager-role">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">Rol de jefe</h3>
        <Badge tone={grant ? "success" : "neutral"}>
          {grant ? "Ve a su equipo" : "Sin rol de jefe"}
        </Badge>
      </div>
      <p className="text-muted-foreground text-sm">
        {view.directReports === 1
          ? "1 persona activa la tiene como jefe."
          : `${view.directReports} personas activas la tienen como jefe.`}
      </p>

      <form action={saveAction} className="space-y-3">
        <CompanyField />
        <input name="personId" type="hidden" value={personId} />
        <div className="flex items-center gap-2">
          <Checkbox
            defaultChecked={grant?.includeIndirect ?? false}
            id="manager-indirect"
            name="includeIndirect"
          />
          <Label htmlFor="manager-indirect">Incluir reportes indirectos</Label>
        </div>
        <Button disabled={saving} type="submit" variant="secondary">
          {grant ? "Guardar" : "Dar rol de jefe"}
        </Button>
        <Message state={saveState} />
      </form>

      {view.delegations.length > 0 ? (
        <ul className="divide-y">
          {view.delegations.map((delegation) => (
            <EndDelegation
              delegation={delegation}
              key={delegation.id}
              personId={personId}
            />
          ))}
        </ul>
      ) : null}

      {grant ? (
        <form action={revokeAction}>
          <CompanyField />
          <input name="personId" type="hidden" value={personId} />
          <Button disabled={revoking} type="submit" variant="ghost">
            Quitar rol de jefe
          </Button>
        </form>
      ) : null}
      <Message state={revokeState} />
    </div>
  );
};
