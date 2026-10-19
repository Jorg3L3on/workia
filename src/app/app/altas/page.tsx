import type { Metadata } from "next";
import Link from "next/link";

import { ListPageHeader } from "@/components/list/list-page-header";
import { Badge } from "@/components/ui/badge";
import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Label } from "@/components/ui/label";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { formatDateMx } from "@/lib/format/date";
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
import { toneFor } from "@/lib/ui/status-tone";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.altas,
};

type AltasPageProps = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

/** Hiring from HR to Payroll with two approvals (WRK-I5-7). */
const AltasPage = async ({ searchParams }: AltasPageProps) => {
  const session = await requirePeopleRead();
  const { error, message } = await searchParams;
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
      <ListPageHeader
        description="RH captura y aprueba; Nóminas da el segundo visto bueno. La misma persona no puede aprobar las dos etapas."
        descriptionSecondary="Altas en proceso y completas."
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
        <section className="workia-pass-card space-y-3 p-5">
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
                  defaultValue={candidates[0]?.id}
                  id="alta-person"
                  name="personId"
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

      <section className="workia-pass-card p-5">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Sin altas todavía.</p>
        ) : (
          <table className="w-full text-sm" data-testid="altas-table">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-2 font-medium">Persona</th>
                <th className="py-2 font-medium">Etapa</th>
                <th className="py-2 font-medium">Checklist</th>
                <th className="py-2 font-medium">Iniciada</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ onboarding, person }) => (
                <tr key={onboarding.id} className="border-t">
                  <td className="py-2 font-medium">
                    {formatPersonName(person)}
                  </td>
                  <td className="py-2">
                    <Badge tone={toneFor("onboarding", onboarding.stage)}>
                      {onboardingStageLabels[onboarding.stage]}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground py-2">
                    {7 - missingChecklist(onboarding.checklist).length}/7
                  </td>
                  <td className="text-muted-foreground py-2">
                    {formatDateMx(
                      onboarding.createdAt.toISOString().slice(0, 10),
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/app/altas/${onboarding.id}`}>Abrir</Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

export default AltasPage;
