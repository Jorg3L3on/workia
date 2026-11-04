"use client";

import { BellRingIcon } from "lucide-react";

import { useIncidenciaAction } from "@/components/incidencias/use-action";
import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { LFT_ALERTS_COPY } from "@/lib/lft-alerts/copy";
import type { PayPeriodActionState } from "@/lib/pay-periods/copy";

/** «Revisar ahora»: runs the LFT checks of the active company (W2-19). */
export const RunAlertsButton = ({
  action,
}: {
  action: (
    state: PayPeriodActionState,
    formData: FormData,
  ) => Promise<PayPeriodActionState>;
}) => {
  const { pending, error, handleSubmit } = useIncidenciaAction(action);

  return (
    <form className="flex flex-col items-end gap-1" onSubmit={handleSubmit}>
      <CompanyField />
      <Button
        aria-busy={pending}
        data-testid="lft-alerts-run"
        disabled={pending}
        type="submit"
        variant="secondary"
      >
        <BellRingIcon aria-hidden data-icon="inline-start" />
        {pending ? LFT_ALERTS_COPY.running : LFT_ALERTS_COPY.runNow}
      </Button>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
};
