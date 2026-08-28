"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { noRenewContractAction } from "@/lib/contracts/actions";

type NoRenewButtonProps = {
  contractId: string;
};

const PendingButton = () => {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} size="sm" type="submit" variant="ghost">
      {pending ? "Guardando…" : "No renovar"}
    </Button>
  );
};

export const NoRenewButton = ({ contractId }: NoRenewButtonProps) => {
  const handleNoRenew = noRenewContractAction.bind(null, contractId);

  return (
    <form action={handleNoRenew}>
      <PendingButton />
    </form>
  );
};
