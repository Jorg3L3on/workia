import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { AltasDataTable } from "@/components/onboarding/altas-data-table";
import { StartAltaSheet } from "@/components/onboarding/start-alta-sheet";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { listOnboardings } from "@/lib/onboarding";
import {
  missingChecklist,
  onboardingStageLabels,
} from "@/lib/onboarding/schema";
import { blocksNewOnboarding } from "@/lib/onboarding/eligibility";
import { listActivePeopleForSelect } from "@/lib/people";
import { listEmploymentSummaries } from "@/lib/people/employment";
import { requirePeopleRead } from "@/lib/people/auth";
import { formatPersonName } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.altas,
};

type AltasPageProps = {
  searchParams: Promise<{ error?: string; message?: string; persona?: string }>;
};

/** Hiring from HR to Payroll with two approvals (WRK-I5-7). */
const AltasPage = async ({ searchParams }: AltasPageProps) => {
  const session = await requirePeopleRead();
  const { error, message, persona } = await searchParams;
  const [rows, canStart] = await Promise.all([
    listOnboardings(session.companyId),
    userHasPermission(session.user.id, "people:update"),
  ]);
  // One alta per employment period: a rehired person can get a new one.
  const [active, periods] = canStart
    ? await Promise.all([
        listActivePeopleForSelect(session.companyId),
        listEmploymentSummaries(session.companyId),
      ])
    : [[], new Map()];
  const candidates = active.filter((person) => {
    const summary = periods.get(person.id);
    const open = summary?.abierto
      ? { id: summary.periodId, periodCount: summary.periodCount }
      : null;

    return !rows.some(
      (row) =>
        row.onboarding.personId === person.id &&
        blocksNewOnboarding(row.onboarding, open),
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="RH captura y aprueba; Nóminas da el segundo visto bueno."
        primary={
          canStart && candidates.length > 0 ? (
            <StartAltaSheet
              candidates={candidates.map((person) => ({
                id: person.id,
                name: formatPersonName(person),
              }))}
              initialPersonId={
                candidates.some((person) => person.id === persona)
                  ? persona
                  : undefined
              }
            />
          ) : null
        }
        title="Altas"
      />

      {error ? (
        <p className="text-destructive text-sm font-medium" role="alert">
          {error === "domain" && message
            ? message
            : error === "permission"
              ? "No tienes permiso para esta acción."
              : "No se pudo completar la acción."}
        </p>
      ) : null}

      <AltasDataTable
        altas={rows.map(({ onboarding, person }) => ({
          id: onboarding.id,
          personName: formatPersonName(person),
          stage: onboarding.stage,
          stageLabel: onboardingStageLabels[onboarding.stage],
          checklistDone: 7 - missingChecklist(onboarding.checklist).length,
          checklistTotal: 7,
          startedOn: onboarding.createdAt.toISOString().slice(0, 10),
        }))}
      />
    </div>
  );
};

export default AltasPage;
