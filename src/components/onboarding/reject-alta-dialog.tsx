"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rejectOnboardingAction } from "@/lib/onboarding/actions";

const RejectButton = () => {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} type="submit" variant="destructive">
      {pending ? "Rechazando…" : "Rechazar alta"}
    </Button>
  );
};

/** «Rechazar…» in the alta's footer: asks for the reason first. */
export const RejectAltaDialog = ({
  onboardingId,
  personName,
}: {
  onboardingId: string;
  personName: string;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button variant="secondary">Rechazar…</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rechazar alta</DialogTitle>
          <DialogDescription>
            {personName}. El motivo queda registrado en el alta.
          </DialogDescription>
        </DialogHeader>
        <form
          action={rejectOnboardingAction.bind(null, onboardingId)}
          className="space-y-4"
        >
          <CompanyField />
          <div className="space-y-2">
            <Label htmlFor="motivo">Motivo</Label>
            <Textarea
              autoFocus
              id="motivo"
              maxLength={500}
              name="motivo"
              placeholder="Ej. El número de crédito Infonavit no coincide."
              required
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
            <RejectButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
