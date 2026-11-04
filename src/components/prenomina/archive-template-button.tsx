"use client";

import { useState } from "react";
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
import type { PayPeriodActionState } from "@/lib/pay-periods/copy";
import { PRENOMINA_COPY } from "@/lib/prenomina/copy";

/** Archives one pre-nómina template, behind a confirm (W2-18). */
export const ArchiveTemplateButton = ({
  id,
  action,
}: {
  id: string;
  action: (
    state: PayPeriodActionState,
    formData: FormData,
  ) => Promise<PayPeriodActionState>;
}) => {
  const [pending, setPending] = useState(false);

  const archive = (form: HTMLFormElement) => {
    setPending(true);
    void action({}, new FormData(form))
      .then((result) => {
        if (result.error) toast.error(result.error);
        else if (result.message) toast.success(result.message);
      })
      .finally(() => setPending(false));
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button disabled={pending} size="sm" variant="ghost">
          {PRENOMINA_COPY.archive}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            archive(event.currentTarget);
          }}
        >
          <CompanyField />
          <input name="id" type="hidden" value={id} />
          <AlertDialogHeader>
            <AlertDialogTitle>{PRENOMINA_COPY.archive}</AlertDialogTitle>
            <AlertDialogDescription>
              {PRENOMINA_COPY.archiveConfirm}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction type="submit">
              {PRENOMINA_COPY.archive}
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
};
