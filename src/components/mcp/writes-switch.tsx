"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { CompanyField } from "@/components/tenant/company-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  setWritesEnabledAction,
  type ConnectionActionState,
} from "@/lib/mcp/actions";
import { activeTone } from "@/lib/ui/status-tone";

type WritesSwitchProps = {
  enabled: boolean;
  canToggle: boolean;
};

/** «Apagar escrituras» (spec §7): every MCP write answers WRITES_DISABLED at once. */
export const WritesSwitch = ({ enabled, canToggle }: WritesSwitchProps) => {
  const [state, action, pending] = useActionState<
    ConnectionActionState,
    FormData
  >(setWritesEnabledAction, {});
  const last = useRef<ConnectionActionState | null>(null);

  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3"
      data-testid="writes-switch"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Escrituras por asistente</h2>
          <Badge tone={activeTone(enabled)}>
            {enabled ? "Encendidas" : "Apagadas"}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {enabled
            ? "Los asistentes con permiso de escritura pueden hacer cambios. Cada cambio pide vista previa y confirmación, y queda en la auditoría como «MCP»."
            : "Ningún asistente puede hacer cambios en esta empresa; sólo consultar. ChatGPT nunca escribe."}
        </p>
      </div>
      {canToggle ? (
        <form action={action}>
          <CompanyField />
          <input
            type="hidden"
            name="enabled"
            value={enabled ? "false" : "true"}
          />
          <Button
            type="submit"
            variant={enabled ? "destructive" : "secondary"}
            disabled={pending}
          >
            {enabled ? "Apagar escrituras" : "Encender escrituras"}
          </Button>
        </form>
      ) : null}
    </div>
  );
};
