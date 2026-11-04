"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  setGroupAdminAction,
  type GroupAdminActionState,
} from "@/lib/transfers/admin-actions";

const initialState: GroupAdminActionState = {};

/** Gives the group admin grant by email (W2-24). */
export const GroupAdminForm = () => {
  const [state, action, pending] = useActionState(
    setGroupAdminAction,
    initialState,
  );

  return (
    <form action={action} className="space-y-2">
      <input name="grant" type="hidden" value="1" />
      <Label htmlFor="group-admin-email">Correo de la cuenta</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-sm"
          id="group-admin-email"
          name="email"
          required
          type="email"
        />
        <Button disabled={pending} type="submit">
          Dar acceso
        </Button>
      </div>
      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-sm" role="status">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
};

/** Takes the grant away from one user. */
export const RevokeGroupAdminButton = ({ email }: { email: string }) => {
  const [state, action, pending] = useActionState(
    setGroupAdminAction,
    initialState,
  );

  return (
    <form action={action} className="flex items-center gap-2">
      <input name="email" type="hidden" value={email} />
      <input name="grant" type="hidden" value="0" />
      {state.error ? (
        <span className="text-destructive text-xs">{state.error}</span>
      ) : null}
      <Button disabled={pending} size="sm" type="submit" variant="secondary">
        Quitar acceso
      </Button>
    </form>
  );
};
