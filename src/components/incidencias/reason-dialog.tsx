"use client";

import { useState } from "react";

import { CompanyField } from "@/components/tenant/company-context";
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
import { INCIDENCIAS_COPY } from "@/lib/incidencias/copy";

import { useIncidenciaAction, type IncidenciaAction } from "./use-action";

/**
 * A button that asks for a reason before an HR decision: justify or void an
 * incidencia, or cancel a justification. Every one of them is audited.
 */
export const ReasonDialog = ({
  label,
  title,
  description,
  fields,
  action,
  testId,
  destructive = false,
}: {
  label: string;
  title: string;
  description: string;
  fields: Record<string, string>;
  action: IncidenciaAction;
  testId: string;
  destructive?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const { pending, error, setError, handleSubmit } = useIncidenciaAction(
    action,
    () => setOpen(false),
  );

  return (
    <>
      <Button
        data-testid={testId}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="secondary"
      >
        {label}
      </Button>
      <Dialog
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          setError(null);
        }}
        open={open}
      >
        <DialogContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <CompanyField />
            {Object.entries(fields).map(([name, value]) => (
              <input key={name} name={name} type="hidden" value={value} />
            ))}
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={`${testId}-reason`}>
                {INCIDENCIAS_COPY.reasonLabel}
              </Label>
              <Textarea
                id={`${testId}-reason`}
                maxLength={280}
                name="reason"
                required
              />
            </div>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                disabled={pending}
                onClick={() => setOpen(false)}
                type="button"
                variant="secondary"
              >
                Cancelar
              </Button>
              <Button
                aria-busy={pending}
                data-testid={`${testId}-confirm`}
                disabled={pending}
                type="submit"
                variant={destructive ? "destructive" : "primary"}
              >
                {pending ? "Guardando…" : label}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
