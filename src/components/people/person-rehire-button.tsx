"use client";

import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";

import { RehireDialog } from "@/components/people/rehire-dialog";
import type { EmploymentFormAction } from "@/components/people/termination-dialog";
import { Button } from "@/components/ui/button";

type PersonRehireButtonProps = {
  personName: string;
  /** The same bound setPersonStatusAction(personId, "activa") the ⋯ menu uses. */
  action: EmploymentFormAction;
  lastBaja: { fechaBaja: string | null; recontratable: boolean | null } | null;
};

/**
 * «Reingresar» on the baja block: opens the menu's RehireDialog (which warns
 * when the last baja said not rehirable). No logic of its own.
 */
export const PersonRehireButton = ({
  personName,
  action,
  lastBaja,
}: PersonRehireButtonProps) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button" variant="secondary">
        <RotateCcwIcon aria-hidden data-icon="inline-start" />
        Reingresar
      </Button>
      <RehireDialog
        action={action}
        lastBaja={lastBaja}
        onOpenChange={setOpen}
        open={open}
        personName={personName}
      />
    </>
  );
};
