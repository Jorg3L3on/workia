"use client";

import { LockIcon, LockOpenIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CompanyField } from "@/components/tenant/company-context";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PAY_PERIOD_COPY,
  type PayPeriodActionState,
} from "@/lib/pay-periods/copy";
import { MAX_REOPEN_REASON } from "@/lib/pay-periods/quincena";

type PayPeriodAction = (
  state: PayPeriodActionState,
  formData: FormData,
) => Promise<PayPeriodActionState>;

type PayPeriodActionsProps = {
  period: string;
  label: string;
  status: "open" | "closed";
  closeAction: PayPeriodAction;
  reopenAction: PayPeriodAction;
};

/** Close (behind a confirm) or reopen (with a reason) one quincena. */
export const PayPeriodActions = ({
  period,
  label,
  status,
  closeAction,
  reopenAction,
}: PayPeriodActionsProps) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    setOpen(next);
    setError(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const action = status === "open" ? closeAction : reopenAction;

    setPending(true);
    setError(null);
    void action({}, data)
      .then((result) => {
        if (result.error) {
          setError(result.error);
          return;
        }

        toast.success(result.message ?? label);
        setOpen(false);
      })
      .finally(() => setPending(false));
  };

  const hidden = (
    <>
      <CompanyField />
      <input name="period" type="hidden" value={period} />
    </>
  );
  const errorLine = error ? (
    <p className="text-destructive text-sm" role="alert">
      {error}
    </p>
  ) : null;

  if (status === "open") {
    return (
      <>
        <Button
          data-testid="pay-period-close"
          onClick={() => setOpen(true)}
          type="button"
          variant="primary"
        >
          <LockIcon aria-hidden data-icon="inline-start" />
          {PAY_PERIOD_COPY.closeButton}
        </Button>
        <AlertDialog onOpenChange={handleOpenChange} open={open}>
          <AlertDialogContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              {hidden}
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {PAY_PERIOD_COPY.closeConfirmTitle}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {label}. {PAY_PERIOD_COPY.closeConfirm}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {errorLine}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>
                  Cancelar
                </AlertDialogCancel>
                <Button
                  aria-busy={pending}
                  data-testid="pay-period-close-confirm"
                  disabled={pending}
                  type="submit"
                  variant="primary"
                >
                  {pending ? "Cerrando…" : PAY_PERIOD_COPY.closeButton}
                </Button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <Button
        data-testid="pay-period-reopen"
        onClick={() => setOpen(true)}
        type="button"
        variant="secondary"
      >
        <LockOpenIcon aria-hidden data-icon="inline-start" />
        {PAY_PERIOD_COPY.reopenButton}
      </Button>
      <Dialog onOpenChange={handleOpenChange} open={open}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{PAY_PERIOD_COPY.reopenTitle}</DialogTitle>
            <DialogDescription>
              {label}. {PAY_PERIOD_COPY.reopenDescription}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {hidden}
            {errorLine}
            <div className="space-y-1.5">
              <Label htmlFor="pay-period-reason">
                {PAY_PERIOD_COPY.reasonLabel}
              </Label>
              <Textarea
                id="pay-period-reason"
                maxLength={MAX_REOPEN_REASON}
                name="reason"
                required
              />
            </div>
            <DialogFooter>
              <Button
                disabled={pending}
                onClick={() => handleOpenChange(false)}
                type="button"
                variant="ghost"
              >
                Cancelar
              </Button>
              <Button
                aria-busy={pending}
                data-testid="pay-period-reopen-confirm"
                disabled={pending}
                type="submit"
                variant="primary"
              >
                {pending ? "Reabriendo…" : PAY_PERIOD_COPY.reopenButton}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
