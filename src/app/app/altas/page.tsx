import type { Metadata } from "next";

import { PlusIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { AltasDataTable } from "@/components/onboarding/altas-data-table";
import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Label } from "@/components/ui/label";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { listOnboardings } from "@/lib/onboarding";
import { startOnboardingAction } from "@/lib/onboarding/actions";
import {
  missingChecklist,
  onboardingStageLabels,
} from "@/lib/onboarding/schema";
import { listActivePeopleForSelect } from "@/lib/people";
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
  const withAlta = new Set(rows.map((row) => row.onboarding.personId));
  const candidates = canStart
    ? (await listActivePeopleForSelect(session.companyId)).filter(
        (person) => !withAlta.has(person.id),
      )
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="RH captura y aprueba; Nóminas da el segundo visto bueno."
        primary={
          canStart && candidates.length > 0
            ? { label: "Iniciar alta", icon: PlusIcon, href: "#iniciar-alta" }
            : null
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

      {canStart ? (
        <section
          className="workia-pass-card scroll-mt-20 space-y-3 p-5"
          id="iniciar-alta"
        >
          <h2 className="text-sm font-semibold">Iniciar alta</h2>
          {candidates.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Todas las personas activas ya tienen alta. Da de alta el
              expediente en Personas primero.
            </p>
          ) : (
            <form
              action={startOnboardingAction}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <CompanyField />
              <div className="space-y-1 sm:w-80">
                <Label htmlFor="alta-person">Persona</Label>
                <FormSelect
                  defaultValue={
                    candidates.some((person) => person.id === persona)
                      ? persona
                      : undefined
                  }
                  id="alta-person"
                  name="personId"
                  placeholder="Elige una persona"
                  required
                  options={candidates.map((person) => ({
                    value: person.id,
                    label: formatPersonName(person),
                  }))}
                  variant="field"
                />
              </div>
              <Button type="submit" variant="secondary">
                Iniciar alta
              </Button>
            </form>
          )}
        </section>
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
