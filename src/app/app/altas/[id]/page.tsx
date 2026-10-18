import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getOnboardingById } from "@/lib/onboarding";
import {
  approveOnboardingAction,
  rejectOnboardingAction,
  updateOnboardingAction,
} from "@/lib/onboarding/actions";
import {
  INFONAVIT_DISCOUNT_TYPES,
  infonavitDiscountLabels,
  missingChecklist,
  ONBOARDING_CHECKLIST,
  onboardingChecklistLabels,
  onboardingStageLabels,
} from "@/lib/onboarding/schema";
import { requirePeopleRead } from "@/lib/people/auth";
import { formatPersonName } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Alta",
};

type AltaPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    message?: string;
    saved?: string;
    approved?: string;
    rejected?: string;
    started?: string;
  }>;
};

const STATUS: Record<string, string> = {
  saved: "Captura guardada.",
  approved: "Visto bueno registrado.",
  rejected: "Alta rechazada.",
  started: "Alta iniciada. Captura el checklist y apruébala.",
};

/** One alta: checklist, Infonavit/Fonacot and the two approvals (WRK-I5-7). */
const AltaPage = async ({ params, searchParams }: AltaPageProps) => {
  const session = await requirePeopleRead();
  const { id } = await params;
  const query = await searchParams;
  const row = await getOnboardingById(session.companyId, id);

  if (!row) {
    notFound();
  }

  const { onboarding, person } = row;
  const [canHr, canPayroll] = await Promise.all([
    userHasPermission(session.user.id, "people:update"),
    userHasPermission(session.user.id, "payroll:approve"),
  ]);
  const open =
    onboarding.stage === "rh_captura" ||
    onboarding.stage === "pendiente_nominas";
  const canEdit =
    open && (onboarding.stage === "rh_captura" ? canHr : canPayroll);
  const sameApprover =
    onboarding.stage === "pendiente_nominas" &&
    onboarding.rhApprovedBy === session.user.id;
  const missing = missingChecklist(onboarding.checklist);
  const status = Object.keys(STATUS).find(
    (key) => query[key as keyof typeof query],
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-xs tracking-widest uppercase">
            Alta · {onboardingStageLabels[onboarding.stage]}
          </p>
          <h1 className="text-xl font-semibold">{formatPersonName(person)}</h1>
        </div>
        <Button asChild variant="ghost">
          <Link href={`/app/personas/${person.id}`}>Ver expediente</Link>
        </Button>
      </div>

      {query.error ? (
        <p className="text-destructive text-sm font-medium" role="alert">
          {query.error === "domain" && query.message
            ? query.message
            : query.error === "permission"
              ? "No tienes permiso para esta acción en esta etapa."
              : "No se pudo completar la acción."}
        </p>
      ) : null}
      {status ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          {STATUS[status]}
        </p>
      ) : null}

      <ol
        className="grid gap-2 text-sm sm:grid-cols-2"
        data-testid="alta-stages"
      >
        <li className="workia-pass-card p-3">
          <p className="font-medium">1. Visto bueno de RH</p>
          <p className="text-muted-foreground text-xs">
            {onboarding.rhApprovedAt
              ? `Aprobado el ${onboarding.rhApprovedAt.toLocaleDateString("es-MX")}`
              : "Pendiente"}
          </p>
        </li>
        <li className="workia-pass-card p-3">
          <p className="font-medium">2. Visto bueno de Nóminas</p>
          <p className="text-muted-foreground text-xs">
            {onboarding.payrollApprovedAt
              ? `Aprobado el ${onboarding.payrollApprovedAt.toLocaleDateString("es-MX")}`
              : onboarding.stage === "rechazado"
                ? `Rechazado: ${onboarding.rejectedReason}`
                : "Pendiente"}
          </p>
        </li>
      </ol>

      <form
        action={updateOnboardingAction.bind(null, onboarding.id)}
        className="workia-pass-card space-y-5 p-5"
      >
        <CompanyField />
        <fieldset className="space-y-2" disabled={!canEdit}>
          <legend className="text-sm font-semibold">Checklist</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ONBOARDING_CHECKLIST.map((item) => (
              <label key={item} className="flex items-center gap-2 text-sm">
                <input
                  defaultChecked={Boolean(onboarding.checklist[item])}
                  name={`checklist_${item}`}
                  type="checkbox"
                />
                {onboardingChecklistLabels[item]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-3" disabled={!canEdit}>
          <legend className="text-sm font-semibold sm:col-span-3">
            Infonavit
          </legend>
          <div className="space-y-1">
            <Label htmlFor="infonavitCredito">Número de crédito</Label>
            <Input
              defaultValue={onboarding.infonavitCredito ?? ""}
              id="infonavitCredito"
              name="infonavitCredito"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="infonavitTipoDescuento">Tipo de descuento</Label>
            <FormSelect
              defaultValue={onboarding.infonavitTipoDescuento ?? ""}
              id="infonavitTipoDescuento"
              name="infonavitTipoDescuento"
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
              defaultValue={onboarding.infonavitFactor ?? ""}
              id="infonavitFactor"
              inputMode="decimal"
              name="infonavitFactor"
              step="0.0001"
              type="number"
            />
          </div>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-3" disabled={!canEdit}>
          <legend className="text-sm font-semibold sm:col-span-3">
            Fonacot
          </legend>
          <div className="space-y-1">
            <Label htmlFor="fonacotCredito">Número de crédito</Label>
            <Input
              defaultValue={onboarding.fonacotCredito ?? ""}
              id="fonacotCredito"
              name="fonacotCredito"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fonacotDescuento">Descuento ($)</Label>
            <Input
              defaultValue={onboarding.fonacotDescuento ?? ""}
              id="fonacotDescuento"
              inputMode="decimal"
              name="fonacotDescuento"
              step="0.01"
              type="number"
            />
          </div>
        </fieldset>

        {canEdit ? (
          <Button type="submit" variant="outline">
            Guardar captura
          </Button>
        ) : null}
      </form>

      {open ? (
        <section className="workia-pass-card space-y-3 p-5">
          <h2 className="text-sm font-semibold">
            {onboarding.stage === "rh_captura"
              ? "Visto bueno de RH"
              : "Visto bueno de Nóminas"}
          </h2>
          {onboarding.stage === "rh_captura" && missing.length > 0 ? (
            <p className="text-muted-foreground text-sm">
              Falta en el checklist:{" "}
              {missing
                .map((item) => onboardingChecklistLabels[item])
                .join(", ")}
              .
            </p>
          ) : null}
          {sameApprover ? (
            <p className="text-muted-foreground text-sm">
              Tú diste el visto bueno de RH; el de Nóminas lo da otra persona.
            </p>
          ) : null}
          {canEdit && !sameApprover ? (
            <form action={approveOnboardingAction.bind(null, onboarding.id)}>
              <CompanyField />
              <Button
                disabled={
                  onboarding.stage === "rh_captura" && missing.length > 0
                }
                type="submit"
              >
                {onboarding.stage === "rh_captura"
                  ? "Aprobar y enviar a Nóminas"
                  : "Aprobar alta"}
              </Button>
            </form>
          ) : null}
          {onboarding.stage === "pendiente_nominas" && canPayroll ? (
            <form
              action={rejectOnboardingAction.bind(null, onboarding.id)}
              className="space-y-2 border-t pt-3"
            >
              <CompanyField />
              <Label htmlFor="motivo">Rechazar con motivo</Label>
              <Textarea id="motivo" maxLength={500} name="motivo" required />
              <Button type="submit" variant="ghost">
                Rechazar alta
              </Button>
            </form>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};

export default AltaPage;
