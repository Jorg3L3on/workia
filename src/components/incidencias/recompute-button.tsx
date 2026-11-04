"use client";

import { RefreshCwIcon } from "lucide-react";

import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { INCIDENCIAS_COPY } from "@/lib/incidencias/copy";

import { useIncidenciaAction, type IncidenciaAction } from "./use-action";

/** Recomputes an open quincena from its punches and justifications. */
export const RecomputeButton = ({
  period,
  action,
}: {
  period: string;
  action: IncidenciaAction;
}) => {
  const { pending, error, handleSubmit } = useIncidenciaAction(action);

  return (
    <form className="flex flex-col gap-1" onSubmit={handleSubmit}>
      <CompanyField />
      <input name="period" type="hidden" value={period} />
      <Button
        aria-busy={pending}
        data-testid="pay-period-recompute"
        disabled={pending}
        type="submit"
        variant="secondary"
      >
        <RefreshCwIcon aria-hidden data-icon="inline-start" />
        {pending ? INCIDENCIAS_COPY.recomputing : INCIDENCIAS_COPY.recompute}
      </Button>
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
};
