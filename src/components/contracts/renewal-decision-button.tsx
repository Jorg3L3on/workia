"use client";

import { CalendarCheckIcon } from "lucide-react";
import { useState } from "react";

import type { CompensationDefaults } from "@/components/contracts/compensation-fields";
import { RenewalDecisionDialog } from "@/components/contracts/renewal-decision-dialog";
import { Button } from "@/components/ui/button";
import type { ContractTemplate } from "@/lib/db/schema";

type RenewalDecisionButtonProps = {
  contractId: string;
  personName: string;
  endDate: string;
  templates: ContractTemplate[];
  positions: { id: string; name: string }[];
  canSeeCompensation: boolean;
  compensation?: CompensationDefaults;
};

/** «Decidir renovación» on the expediente's Contratos tab: the tray's dialog. */
export const RenewalDecisionButton = (props: RenewalDecisionButtonProps) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="secondary">
        <CalendarCheckIcon aria-hidden />
        Decidir renovación
      </Button>
      {open ? (
        <RenewalDecisionDialog {...props} onOpenChange={setOpen} open />
      ) : null}
    </>
  );
};
