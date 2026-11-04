import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TeamPageHeader } from "@/components/manager/team-page-header";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { formatDateMx } from "@/lib/format/date";
import { getManagerAccess, getTeamMember } from "@/lib/managers";

export const metadata: Metadata = { title: "Persona del equipo" };

type TeamMemberPageProps = { params: Promise<{ personId: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One person of the manager's team (W2-07). The id in the URL is only a
 * lookup inside the team: anyone outside it, in this company or another,
 * is a 404.
 */
const TeamMemberPage = async ({ params }: TeamMemberPageProps) => {
  const context = await requireEmployeeContext();
  const access = await getManagerAccess(context);
  const { personId } = await params;

  if (!access || !UUID.test(personId)) {
    notFound();
  }

  const member = await getTeamMember(access, personId);

  if (!member) {
    notFound();
  }

  const facts = [
    { label: "Puesto", value: member.positionName },
    { label: "Área", value: member.areaName },
    { label: "Sucursal", value: member.siteName },
    { label: "Jefe directo", value: member.managerName },
    {
      label: "Fecha de ingreso",
      value: member.fechaIngreso ? formatDateMx(member.fechaIngreso) : null,
    },
  ].filter((fact) => fact.value);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-6 pb-10">
      <TeamPageHeader
        backHref="/mi/equipo"
        backLabel="Mi equipo"
        title={member.name}
      />
      <section className="workia-pass-card px-5 py-4">
        {facts.length > 0 ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {facts.map((fact) => (
              <div className="min-w-0" key={fact.label}>
                <dt className="workia-field-label">{fact.label}</dt>
                <dd className="font-medium break-words">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">
            RH aún no captura el puesto ni la sucursal.
          </p>
        )}
      </section>
    </main>
  );
};

export default TeamMemberPage;
