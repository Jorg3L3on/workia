import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";

import { TeamPageHeader } from "@/components/manager/team-page-header";
import { Badge } from "@/components/ui/badge";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { formatDateMx, isoToday } from "@/lib/format/date";
import { getManagerAccess, listTeamPlaces } from "@/lib/managers";
import { formatPersonName } from "@/lib/people/schema";
import {
  listTodayPage,
  todayCounts,
  todayImports,
  type TeamTodayScope,
} from "@/lib/timeline/today";
import { todayStatus } from "@/lib/timeline/today-status";
import {
  formatClockMx,
  sourceLabel,
  TODAY_INCIDENCIA_LABEL,
  TODAY_STATUS,
} from "@/lib/timeline/today-copy";

export const metadata: Metadata = { title: "Hoy en mi equipo" };

type TodayPageProps = {
  searchParams: Promise<{
    lugar?: string | string[];
    cursor?: string | string[];
  }>;
};

const one = (value?: string | string[]) =>
  typeof value === "string" ? value : null;

const hrefFor = (lugar: string | null, cursor?: string | null) => {
  const params = new URLSearchParams();
  if (lugar) params.set("lugar", lugar);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/mi/equipo/hoy?${query}` : "/mi/equipo/hoy";
};

/**
 * «Hoy» (Workia 2.0 W2-17): who of the manager's team is on shift, absent,
 * late or still without a record today, as of the last import of each
 * source. The counts come from the P-02 aggregates (todayCounts), the list
 * from the P-04 today page, both over the W2-07 team scope, optionally one
 * site or area of it. Nothing here is a counter: it is read on each request.
 */
const TeamTodayPage = async ({ searchParams }: TodayPageProps) => {
  const context = await requireEmployeeContext();
  const access = await getManagerAccess(context);

  if (!access) {
    notFound();
  }

  const params = await searchParams;
  const places = await listTeamPlaces(access);
  const lugar = one(params.lugar);
  const place = places.find((item) => `${item.kind}:${item.id}` === lugar);
  const scope: TeamTodayScope = {
    team: access,
    siteId: place?.kind === "site" ? place.id : null,
    areaId: place?.kind === "area" ? place.id : null,
  };
  const day = isoToday();
  const cursor = one(params.cursor);
  const [counts, imports, page] = await Promise.all([
    todayCounts(access.companyId, scope, day),
    todayImports(access.companyId, scope, day),
    listTodayPage(access.companyId, scope, { day, cursor, limit: 100 }),
  ]);
  const pending = Math.max(counts.roster - counts.present - counts.absent, 0);
  const tiles = [
    { label: "En turno", value: imports.onShift },
    { label: "Faltas", value: counts.absent },
    { label: "Retardos", value: counts.late },
    { label: "Sin registro", value: pending },
  ];
  const placeHref = place ? `${place.kind}:${place.id}` : null;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-6 pb-10">
      <TeamPageHeader
        backHref="/mi/equipo"
        backLabel="Mi equipo"
        subtitle={`${formatDateMx(day)} · ${counts.roster} ${counts.roster === 1 ? "persona" : "personas"}${place ? ` en ${place.name}` : ""}`}
        title="Hoy"
      />

      {places.length > 1 ? (
        <nav
          aria-label="Sucursal o área"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          {[
            { key: null, name: "Todo el equipo" },
            ...places.map((item) => ({
              key: `${item.kind}:${item.id}`,
              name: item.name,
            })),
          ].map((item) => (
            <Link
              aria-current={item.key === placeHref ? "page" : undefined}
              className="aria-[current=page]:bg-foreground aria-[current=page]:text-background inline-flex min-h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium"
              href={hrefFor(item.key)}
              key={item.key ?? "all"}
            >
              {item.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <section
        aria-label="Resumen del día"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        data-testid="today-counts"
      >
        {tiles.map((tile) => (
          <div className="workia-pass-card px-4 py-3" key={tile.label}>
            <p className="text-2xl font-semibold tabular-nums">{tile.value}</p>
            <p className="text-muted-foreground text-sm">{tile.label}</p>
          </div>
        ))}
      </section>

      <section
        aria-label="Corte de los registros"
        className="text-muted-foreground space-y-1 text-sm"
        data-testid="today-sources"
      >
        {imports.sources.length > 0 ? (
          imports.sources.map((source) => (
            <p key={source.source}>
              {sourceLabel(source.source)}: último registro a las{" "}
              <span className="text-foreground font-medium">
                {formatClockMx(source.lastPunchAt)}
              </span>{" "}
              · {source.people} {source.people === 1 ? "persona" : "personas"}
            </p>
          ))
        ) : (
          <p>Aún no llega ningún registro de asistencia de hoy.</p>
        )}
      </section>

      <section aria-labelledby="hoy-lista" className="space-y-2">
        <h2 className="text-base font-semibold" id="hoy-lista">
          Personas
        </h2>
        {page.items.length > 0 ? (
          <ul className="workia-pass-card divide-y" data-testid="today-list">
            {page.items.map((row) => {
              const day = todayStatus(row);
              const status = TODAY_STATUS[day.status];
              const times = [
                day.firstIn ? `Entrada ${formatClockMx(day.firstIn)}` : null,
                day.lastOut && day.status === "left"
                  ? `Salida ${formatClockMx(day.lastOut)}`
                  : null,
              ].filter(Boolean);
              const flags = day.incidencias
                .filter((item) => item.kind !== "falta")
                .map(
                  (item) =>
                    `${TODAY_INCIDENCIA_LABEL[item.kind] ?? item.kind}${item.minutes ? ` ${item.minutes} min` : ""}${item.justified ? " (justificado)" : ""}`,
                );

              return (
                <li key={row.personId}>
                  <Link
                    className="flex min-h-14 items-center justify-between gap-3 px-5 py-3"
                    href={`/mi/equipo/${row.personId}`}
                  >
                    <span className="min-w-0 space-y-0.5">
                      <span className="block font-medium break-words">
                        {formatPersonName(row)}
                      </span>
                      {times.length + flags.length > 0 ? (
                        <span className="text-muted-foreground block text-sm break-words">
                          {[...times, ...flags].join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <ChevronRightIcon
                        aria-hidden
                        className="text-muted-foreground size-4"
                      />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="workia-empty-state text-muted-foreground px-5 py-4 text-sm">
            {cursor
              ? "No hay más personas."
              : "Nadie te reporta todavía. RH asigna el jefe en el expediente de cada persona."}
          </p>
        )}
        {page.next ? (
          <Link
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            href={hrefFor(placeHref, page.next)}
          >
            Ver más
          </Link>
        ) : null}
      </section>
    </main>
  );
};

export default TeamTodayPage;
