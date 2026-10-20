"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { CompanyField } from "@/components/tenant/company-context";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  setWritesEnabledAction,
  type ConnectionActionState,
} from "@/lib/mcp/actions";

type WritesSwitchProps = {
  enabled: boolean;
  canToggle: boolean;
};

/** The writes setting row (spec §7): off, every MCP write answers WRITES_DISABLED at once. */
export const WritesSwitch = ({ enabled, canToggle }: WritesSwitchProps) => {
  const [state, action, pending] = useActionState<
    ConnectionActionState,
    FormData
  >(setWritesEnabledAction, {});
  const last = useRef<ConnectionActionState | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form
      action={action}
      className="flex items-center justify-between gap-4 border-y py-3"
      data-testid="writes-switch"
      ref={formRef}
    >
      <CompanyField />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <div className="min-w-0 space-y-0.5">
        <Label className="text-sm font-medium" htmlFor="writes-enabled">
          Escrituras por asistente
        </Label>
        <p className="text-muted-foreground text-sm">
          {enabled
            ? "Los asistentes con permiso pueden hacer cambios, con vista previa, confirmación y registro en la auditoría."
            : "Los asistentes sólo consultan; ninguno puede hacer cambios en esta empresa."}
          {canToggle ? null : " Sólo un superadministrador puede cambiarlo."}
        </p>
      </div>
      <Switch
        checked={enabled}
        disabled={!canToggle || pending}
        id="writes-enabled"
        onCheckedChange={() => formRef.current?.requestSubmit()}
      />
    </form>
  );
};
