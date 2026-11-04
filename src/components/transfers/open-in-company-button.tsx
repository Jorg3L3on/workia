"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { switchCompanyAction } from "@/lib/tenant/actions";

/** «Abrir en <empresa>»: switches the active company and lands on that row (W2-24). */
export const OpenInCompanyButton = ({
  companyId,
  companyName,
  href,
}: {
  companyId: string;
  companyName: string;
  href: string;
}) => {
  const [state, action, pending] = useActionState(switchCompanyAction, {});

  return (
    <form action={action} className="flex items-center gap-2">
      <input name="companyId" type="hidden" value={companyId} />
      <input name="next" type="hidden" value={href} />
      {state.error ? (
        <span className="text-destructive text-xs" role="alert">
          {state.error}
        </span>
      ) : null}
      <Button disabled={pending} size="sm" type="submit" variant="secondary">
        Abrir en {companyName}
      </Button>
    </form>
  );
};
