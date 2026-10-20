"use client";

import { PlusIcon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormSheet } from "@/components/layout/form-sheet";
import { CompanyField } from "@/components/tenant/company-context";
import { FormSelect } from "@/components/ui/form-select";
import { Label } from "@/components/ui/label";
import { startOnboardingAction } from "@/lib/onboarding/actions";

type StartAltaSheetProps = {
  candidates: { id: string; name: string }[];
  /** From the expediente («Iniciar alta» with ?persona=): opens preselected. */
  initialPersonId?: string;
};

/**
 * «Iniciar alta» (WRK-I6-4): a Sheet whose person picker starts empty, so an
 * alta never starts with one click.
 */
export const StartAltaSheet = ({
  candidates,
  initialPersonId,
}: StartAltaSheetProps) => {
  const [open, setOpen] = useState(Boolean(initialPersonId));
  const [personId, setPersonId] = useState(initialPersonId ?? "");
  const [, action, pending] = useActionState(
    async (_prev: null, formData: FormData) => {
      await startOnboardingAction(formData);
      return null;
    },
    null,
  );

  return (
    <FormSheet
      description="RH captura la checklist y aprueba; Nóminas da el segundo visto bueno."
      formId="iniciar-alta"
      onOpenChange={setOpen}
      open={open}
      pending={pending}
      submitDisabled={!personId}
      submitLabel="Iniciar alta"
      title="Iniciar alta"
      triggerIcon={PlusIcon}
      triggerLabel="Iniciar alta"
    >
      <form action={action} className="space-y-4" id="iniciar-alta">
        <CompanyField />
        <div className="space-y-2">
          <Label htmlFor="alta-person">Persona</Label>
          <FormSelect
            id="alta-person"
            name="personId"
            onValueChange={setPersonId}
            options={candidates.map((person) => ({
              value: person.id,
              label: person.name,
            }))}
            placeholder="Elige una persona"
            required
            value={personId}
            variant="field"
          />
          <p className="text-muted-foreground text-xs">
            Sólo aparecen personas activas sin alta.
          </p>
        </div>
      </form>
    </FormSheet>
  );
};
