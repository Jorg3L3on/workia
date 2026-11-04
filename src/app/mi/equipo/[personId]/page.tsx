import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TeamPageHeader } from "@/components/manager/team-page-header";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { formatDateMx } from "@/lib/format/date";
import { getManagerAccess, getTeamMember } from "@/lib/managers";
import { listPersonEvents } from "@/lib/timeline";
import {
  formatClockMx,
  sourceLabel,
  TODAY_INCIDENCIA_LABEL,
} from "@/lib/timeline/today-copy";
import { readAttendance } from "@/lib/timeline/writers";

export const metadata: Metadata = { title: "Persona del equipo" };

type TeamMemberPageProps = {
  params: Promise<{ personId: string }>;
  searchParams?: Promise<{ historial?: string | string[] }>;
};

const HISTORY_PAGE = 30;

type HistoryEvent = Awaited<
  ReturnType<typeof listPersonEvents>
>["events"][number];

/** One line of the drill-in: the day's punches, or one incidencia. */
const describeEvent = (event: HistoryEvent) => {
  if (event.type === "attendance") {
    const day = readAttendance(event.payload);
    const times = [
      day.firstIn ? `Entrada ${formatClockMx(day.firstIn)}` : null,
      day.lastOut ? `Salida ${formatClockMx(day.lastOut)}` : null,
    ].filter(Boolean);

    return {
      title: "Asistencia",
      detail: [...times, sourceLabel(event.source)].join(" · "),
    };
  }

  const kind = String(event.payload.kind ?? "");
  const minutes =
    typeof event.payload.minutes === "number"
      ? `${event.payload.minutes} min`
      : null;

  return {
    title: TODAY_INCIDENCIA_LABEL[kind] ?? "Incidencia",
    detail: [
      minutes,
      event.payload.justified === true ? "Justificada" : null,
      event.payload.voided === true ? "Cancelada" : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One person of the manager's team (W2-07). The id in the URL is only a
 * lookup inside the team: anyone outside it, in this company or another,
 * is a 404.
 */
const TeamMemberPage = async ({
  params,
  searchParams,
}: TeamMemberPageProps) => {
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

  // The drill-in of the today view (W2-17): attendance and incidencias only,
  // newest first, one keyset range of person_events_person_time_idx. Opened
  // only after the team check above.
  const { historial } = (await searchParams) ?? {};
  const cursor = typeof historial === "string" ? historial : null;
  const history = await listPersonEvents(access.companyId, member.id, {
    types: ["attendance", "incidencia"],
    cursor,
    limit: HISTORY_PAGE,
  });

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

      <section aria-labelledby="persona-historial" className="space-y-2">
        <h2 className="text-base font-semibold" id="persona-historial">
          Asistencia e incidencias
        </h2>
        {history.events.length > 0 ? (
          <ul
            className="workia-pass-card divide-y"
            data-testid="member-history"
          >
            {history.events.map((event) => {
              const line = describeEvent(event);

              return (
                <li className="space-y-0.5 px-5 py-3" key={event.id}>
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{line.title}</span>
                    <span className="text-muted-foreground shrink-0 text-sm">
                      {formatDateMx(event.occurredAt.toISOString())}
                    </span>
                  </p>
                  {line.detail ? (
                    <p className="text-muted-foreground text-sm break-words">
                      {line.detail}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="workia-empty-state text-muted-foreground px-5 py-4 text-sm">
            {cursor
              ? "No hay registros anteriores."
              : "Aún no hay registros de asistencia."}
          </p>
        )}
        {history.next ? (
          <Link
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            href={`/mi/equipo/${member.id}?historial=${encodeURIComponent(history.next)}`}
          >
            Ver anteriores
          </Link>
        ) : null}
      </section>
    </main>
  );
};

export default TeamMemberPage;
