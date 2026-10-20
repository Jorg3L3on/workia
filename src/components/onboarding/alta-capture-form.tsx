"use client";

import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { CompanyField } from "@/components/tenant/company-context";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOnboardingAction } from "@/lib/onboarding/actions";
import {
  INFONAVIT_DISCOUNT_TYPES,
  infonavitDiscountLabels,
  ONBOARDING_CHECKLIST,
  onboardingChecklistLabels,
  type OnboardingChecklistItem,
} from "@/lib/onboarding/schema";

type AltaCaptureFormProps = {
  onboardingId: string;
  canEdit: boolean;
  values: {
    checklist: Partial<Record<OnboardingChecklistItem, boolean>>;
    infonavitCredito: string;
    infonavitTipoDescuento: string;
    infonavitFactor: string;
    fonacotCredito: string;
    fonacotDescuento: string;
  };
};

/** Typing waits this long before saving; checkboxes and selects save at once. */
const TYPING_DELAY_MS = 800;

/**
 * The alta's capture (WRK-I6-4): checklist, Infonavit and Fonacot, saved as
 * they change with a «Guardado» indicator instead of a «Guardar captura» button.
 */
export const AltaCaptureForm = ({
  onboardingId,
  canEdit,
  values,
}: AltaCaptureFormProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const save = () => {
    if (timer.current) clearTimeout(timer.current);
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);

    startTransition(async () => {
      await updateOnboardingAction(onboardingId, data);
      setSaved(true);
    });
  };

  const saveLater = () => {
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, TYPING_DELAY_MS);
  };

  return (
    <form
      className="workia-pass-card space-y-5 p-5"
      data-testid="alta-capture"
      onChange={(event) => {
        const target = event.target as unknown as HTMLInputElement;
        // Text fields save after a pause; the rest (checkboxes) at once.
        if (target.type === "checkbox") save();
        else saveLater();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      ref={formRef}
    >
      <CompanyField />
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Captura</h2>
        {canEdit ? (
          <p
            aria-live="polite"
            className="text-muted-foreground flex items-center gap-1 text-xs"
            data-testid="alta-save-state"
          >
            {pending ? (
              "Guardando…"
            ) : saved ? (
              <>
                <CheckIcon aria-hidden className="size-3.5" />
                Guardado
              </>
            ) : (
              "Los cambios se guardan solos"
            )}
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-2" disabled={!canEdit}>
        <legend className="mb-2 text-sm font-medium">Checklist</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {ONBOARDING_CHECKLIST.map((item) => (
            <label key={item} className="flex items-center gap-2 text-sm">
              <input
                className="accent-primary size-4"
                defaultChecked={Boolean(values.checklist[item])}
                name={`checklist_${item}`}
                type="checkbox"
              />
              {onboardingChecklistLabels[item]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3" disabled={!canEdit}>
        <legend className="mb-2 text-sm font-medium sm:col-span-3">
          Infonavit
        </legend>
        <div className="space-y-1">
          <Label htmlFor="infonavitCredito">Número de crédito</Label>
          <Input
            defaultValue={values.infonavitCredito}
            id="infonavitCredito"
            name="infonavitCredito"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="infonavitTipoDescuento">Tipo de descuento</Label>
          <FormSelect
            defaultValue={values.infonavitTipoDescuento}
            disabled={!canEdit}
            id="infonavitTipoDescuento"
            name="infonavitTipoDescuento"
            // The hidden input does not fire the form's change event.
            onValueChange={() => setTimeout(save, 0)}
            options={[
              { value: "", label: "Sin crédito" },
              ...INFONAVIT_DISCOUNT_TYPES.map((value) => ({
                value,
                label: infonavitDiscountLabels[value],
              })),
            ]}
            variant="field"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="infonavitFactor">Factor de descuento</Label>
          <Input
            defaultValue={values.infonavitFactor}
            id="infonavitFactor"
            inputMode="decimal"
            name="infonavitFactor"
            step="0.0001"
            type="number"
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3" disabled={!canEdit}>
        <legend className="mb-2 text-sm font-medium sm:col-span-3">
          Fonacot
        </legend>
        <div className="space-y-1">
          <Label htmlFor="fonacotCredito">Número de crédito</Label>
          <Input
            defaultValue={values.fonacotCredito}
            id="fonacotCredito"
            name="fonacotCredito"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fonacotDescuento">Descuento ($)</Label>
          <Input
            defaultValue={values.fonacotDescuento}
            id="fonacotDescuento"
            inputMode="decimal"
            name="fonacotDescuento"
            step="0.01"
            type="number"
          />
        </div>
      </fieldset>
    </form>
  );
};
