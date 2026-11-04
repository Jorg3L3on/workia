"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import type { PayPeriodActionState } from "@/lib/pay-periods/copy";

export type IncidenciaAction = (
  state: PayPeriodActionState,
  formData: FormData,
) => Promise<PayPeriodActionState>;

/** Submits a form to a server action, with a toast on success and the error inline. */
export const useIncidenciaAction = (
  action: IncidenciaAction,
  onDone?: () => void,
) => {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setPending(true);
    setError(null);
    void action({}, data)
      .then((result) => {
        if (result.error) {
          setError(result.error);
          return;
        }

        if (result.message) toast.success(result.message);
        onDone?.();
      })
      .finally(() => setPending(false));
  };

  return { pending, error, setError, handleSubmit };
};
