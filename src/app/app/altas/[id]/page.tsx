import type { Metadata } from "next";
import { CheckIcon, UserRoundIcon } from "lucide-react";
import { notFound } from "next/navigation";

import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { CompanyField } from "@/components/tenant/company-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AltaCaptureForm } from "@/components/onboarding/alta-capture-form";
import { RejectAltaDialog } from "@/components/onboarding/reject-alta-dialog";
import { formatDateMx } from "@/lib/format/date";
import { getOnboardingById } from "@/lib/onboarding";
import { approveOnboardingAction } from "@/lib/onboarding/actions";
import {
  missingChecklist,
  onboardingChecklistLabels,
  onboardingStageLabels,
} from "@/lib/onboarding/schema";
import { requirePeopleRead } from "@/lib/people/auth";
import { formatPersonName } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";
import { toneFor } from "@/lib/ui/status-tone";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Alta",
};

type AltaPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    message?: string;
    approved?: string;
    rejected?: string;
    started?: string;
  }>;
};

const STATUS: Record<string, string> = {
  approved: "Visto bueno registrado.",
  rejected: "Alta rechazada.",
  started: "Alta iniciada. Captura el checklist y apruébala.",
};

const AltaStep = ({
  n,
  label,
  detail,
  done,
  current,
  failed = false,
}: {
  n: number;
  label: string;
  detail?: string;
  done: boolean;
  current: boolean;
  failed?: boolean;
}) => (
  <li
    aria-current={current ? "step" : undefined}
    className="flex items-center gap-2"
  >
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
        done && "bg-primary text-primary-foreground border-transparent",
        current && "border-primary text-primary",
        failed && "border-destructive text-destructive",
      )}
    >
      {done ? <CheckIcon aria-hidden className="size-3.5" /> : n}
    </span>
    <span
      className={cn(current || done ? "font-medium" : "text-muted-foreground")}
    >
      {label}
    </span>
    {detail ? (
      <span className="text-muted-foreground text-xs tabular-nums">
        {detail}
      </span>
    ) : null}
    {done ? <span className="sr-only">(aprobado)</span> : null}
  </li>
);

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
  const canDecide = canEdit && !sameApprover;
  const blockedByChecklist =
    onboarding.stage === "rh_captura" && missing.length > 0;
  // The two-person rule and the permissions decide; the footer only says why.
  const cannotDecideReason = sameApprover
    ? "Tú diste el visto bueno de RH; el de Nóminas lo da otra persona."
    : onboarding.stage === "rh_captura"
      ? "Esperando el visto bueno de RH."
      : "Esperando el visto bueno de Nóminas.";
  const status = Object.keys(STATUS).find(
    (key) => query[key as keyof typeof query],
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageBreadcrumbLabel label={formatPersonName(person)} />
      <PageHeader
        menu={[
          {
            label: "Ver expediente",
            icon: UserRoundIcon,
            href: `/app/personas/${person.id}`,
          },
        ]}
        meta="Alta RH → Nóminas"
        status={
          <Badge tone={toneFor("onboarding", onboarding.stage)}>
            {onboardingStageLabels[onboarding.stage]}
          </Badge>
        }
        title={formatPersonName(person)}
        variant="detail"
      />

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
        aria-label="Etapas del alta"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm"
        data-testid="alta-stages"
      >
        <AltaStep
          current={onboarding.stage === "rh_captura"}
          detail={
            onboarding.rhApprovedAt
              ? formatDateMx(onboarding.rhApprovedAt)
              : undefined
          }
          done={Boolean(onboarding.rhApprovedAt)}
          label="RH"
          n={1}
        />
        <li aria-hidden className="bg-border h-px w-8 sm:w-12" />
        <AltaStep
          current={onboarding.stage === "pendiente_nominas"}
          detail={
            onboarding.payrollApprovedAt
              ? formatDateMx(onboarding.payrollApprovedAt)
              : onboarding.stage === "rechazado"
                ? "Rechazada"
                : undefined
          }
          done={Boolean(onboarding.payrollApprovedAt)}
          failed={onboarding.stage === "rechazado"}
          label="Nóminas"
          n={2}
        />
      </ol>
      {onboarding.stage === "rechazado" && onboarding.rejectedReason ? (
        <p className="text-muted-foreground -mt-3 text-sm">
          Motivo del rechazo: {onboarding.rejectedReason}
        </p>
      ) : null}

      <AltaCaptureForm
        canEdit={canEdit}
        onboardingId={onboarding.id}
        values={{
          checklist: onboarding.checklist,
          infonavitCredito: onboarding.infonavitCredito ?? "",
          infonavitTipoDescuento: onboarding.infonavitTipoDescuento ?? "",
          infonavitFactor: onboarding.infonavitFactor ?? "",
          fonacotCredito: onboarding.fonacotCredito ?? "",
          fonacotDescuento: onboarding.fonacotDescuento ?? "",
        }}
      />

      {open ? (
        <div
          className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky -bottom-4 z-10 -mb-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t py-3 backdrop-blur md:-bottom-6 md:-mb-6"
          data-testid="alta-decision"
        >
          {canDecide ? (
            <>
              <p className="text-muted-foreground mr-auto text-sm">
                {blockedByChecklist
                  ? `Falta en el checklist: ${missing
                      .map((item) => onboardingChecklistLabels[item])
                      .join(", ")}.`
                  : onboarding.stage === "rh_captura"
                    ? "Pasa a Nóminas; el segundo visto bueno lo da otra persona."
                    : "Segundo visto bueno: el alta queda aprobada."}
              </p>
              {onboarding.stage === "pendiente_nominas" ? (
                <RejectAltaDialog
                  onboardingId={onboarding.id}
                  personName={formatPersonName(person)}
                />
              ) : null}
              <form action={approveOnboardingAction.bind(null, onboarding.id)}>
                <CompanyField />
                <Button disabled={blockedByChecklist} type="submit">
                  Aprobar alta
                </Button>
              </form>
            </>
          ) : (
            <p className="text-muted-foreground mr-auto text-sm">
              {cannotDecideReason}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default AltaPage;
