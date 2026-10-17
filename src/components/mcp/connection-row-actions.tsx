"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { toast } from "sonner";

import { CompanyField } from "@/components/tenant/company-context";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  hideConnectionAction,
  revokeConnectionAction,
  type ConnectionActionState,
} from "@/lib/mcp/actions";

const useResultToast = (state: ConnectionActionState, success: string) => {
  const last = useRef<ConnectionActionState | null>(null);

  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.error) toast.error(state.error);
    if (state.ok) toast.success(success);
  }, [state, success]);
};

type ConnectionRowActionsProps = {
  connectionId: string;
  name: string;
  active: boolean;
};

/** Revoke (with confirmation) while active; hide once revoked or expired. */
export const ConnectionRowActions = ({
  connectionId,
  name,
  active,
}: ConnectionRowActionsProps) => {
  const formId = useId();
  const [revokeState, revoke, revoking] = useActionState(
    revokeConnectionAction,
    {},
  );
  const [hideState, hide, hiding] = useActionState(hideConnectionAction, {});

  useResultToast(revokeState, "Conexión revocada.");
  useResultToast(hideState, "Conexión oculta.");

  if (!active) {
    return (
      <form action={hide}>
        <CompanyField />
        <input type="hidden" name="connectionId" value={connectionId} />
        <Button type="submit" size="sm" variant="ghost" disabled={hiding}>
          Ocultar
        </Button>
      </form>
    );
  }

  return (
    <>
      <form action={revoke} id={formId} className="hidden">
        <CompanyField />
        <input type="hidden" name="connectionId" value={connectionId} />
      </form>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={revoking}
            aria-label={`Revocar ${name}`}
          >
            Revocar
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Revocar «{name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              El asistente pierde el acceso en su siguiente llamada. Para volver
              a usarlo hay que conectarlo de nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                (
                  document.getElementById(formId) as HTMLFormElement | null
                )?.requestSubmit()
              }
            >
              Revocar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
