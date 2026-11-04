"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { ActionMessage } from "./action-message";

type DecisionState = { error?: string; notice?: string };

/**
 * Approve, or reject with a reason (W2-06). The same form serves the
 * manager in /mi and HR in /app; each passes its own server action and the
 * hidden fields it needs (HR adds the company the page was opened in).
 */
export const DecisionForm = ({
  action: decideAction,
  hidden,
}: {
  action: (state: DecisionState, formData: FormData) => Promise<DecisionState>;
  hidden: Record<string, string>;
}) => {
  const [state, action, pending] = useActionState(decideAction, {});
  const [rejecting, setRejecting] = useState(false);

  if (state.notice) {
    return <ActionMessage state={state} />;
  }

  return (
    <form action={action} className="space-y-3" data-testid="decision-form">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}
      {rejecting ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="decision-reason">Motivo del rechazo</Label>
            <Textarea
              id="decision-reason"
              maxLength={280}
              name="reason"
              required
              rows={3}
            />
            <p className="text-muted-foreground text-xs">
              La persona lo verá en su aviso.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              name="decision"
              size="lg"
              type="submit"
              value="reject"
              variant="destructive"
            >
              Rechazar
            </Button>
            <Button
              disabled={pending}
              onClick={() => setRejecting(false)}
              size="lg"
              type="button"
              variant="ghost"
            >
              Volver
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending}
            name="decision"
            size="lg"
            type="submit"
            value="approve"
          >
            Aprobar
          </Button>
          <Button
            disabled={pending}
            onClick={() => setRejecting(true)}
            size="lg"
            type="button"
            variant="secondary"
          >
            Rechazar…
          </Button>
        </div>
      )}
      <ActionMessage state={state} />
    </form>
  );
};
