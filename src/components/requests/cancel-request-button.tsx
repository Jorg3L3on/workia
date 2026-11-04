"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { cancelRequestAction } from "@/lib/employee/request-actions";

import { ActionMessage } from "./action-message";

/** «Cancelar» on one of the employee's own requests (W2-06). */
export const CancelRequestButton = ({ requestId }: { requestId: string }) => {
  const [state, action, pending] = useActionState(cancelRequestAction, {});

  if (state.notice) {
    return <ActionMessage state={state} />;
  }

  return (
    <form action={action} className="space-y-1">
      <input name="requestId" type="hidden" value={requestId} />
      <Button disabled={pending} size="sm" type="submit" variant="ghost">
        Cancelar solicitud
      </Button>
      <ActionMessage state={state} />
    </form>
  );
};
