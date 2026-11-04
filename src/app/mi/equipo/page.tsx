import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRightIcon } from "lucide-react";

import { DelegationControls } from "@/components/manager/delegation-controls";
import { TeamPageHeader } from "@/components/manager/team-page-header";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { formatDateMx } from "@/lib/format/date";
import {
  getManagerAccess,
  listDelegateCandidates,
  listDelegationsGiven,
  listTeam,
  ownScope,
} from "@/lib/managers";
import { isoToday } from "@/lib/format/date";

export const metadata: Metadata = { title: "Mi equipo" };

type TeamPageProps = {
  searchParams: Promise<{ cursor?: string | string[] }>;
};

/**
 * «Mi equipo» (W2-07): the people the signed-in manager sees, read live from
 * people.manager_id, plus the teams they cover for today. Without a grant or
 * a live delegation it is a 404, like any other screen they cannot open.
 */
const TeamPage = async ({ searchParams }: TeamPageProps) => {
  const context = await requireEmployeeContext();
  const access = await getManagerAccess(context);

  if (!access) {
    notFound();
  }

  const { cursor } = await searchParams;
  const own = ownScope(access);
  const covering = access.scopes.filter((scope) => scope.via === "delegation");
  const [team, delegations, candidates] = await Promise.all([
    listTeam(access, { cursor: typeof cursor === "string" ? cursor : null }),
    own ? listDelegationsGiven(access.companyId, access.accountId) : [],
    own ? listDelegateCandidates(access) : [],
  ]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-6 pb-10">
      <TeamPageHeader
        backHref="/mi"
        backLabel="Inicio"
        subtitle={
          own?.includeIndirect
            ? "Tus reportes directos e indirectos."
            : own
              ? "Las personas que te reportan directamente."
              : null
        }
        title="Mi equipo"
      />

      {covering.length > 0 ? (
        <section
          aria-label="Suplencias"
          className="bg-muted/50 space-y-1 rounded-lg border px-4 py-3 text-sm"
        >
          {covering.map((scope) => (
            <p key={scope.managerAccountId}>
              Suples a <span className="font-medium">{scope.managerName}</span>{" "}
              hasta el {formatDateMx(scope.endsOn)}. Ves su equipo y decides sus
              aprobaciones.
            </p>
          ))}
        </section>
      ) : null}

      <Link
        className="workia-pass-card flex items-center justify-between gap-3 px-5 py-4"
        href="/mi/equipo/hoy"
      >
        <span className="space-y-0.5">
          <span className="block text-base font-semibold">Hoy</span>
          <span className="text-muted-foreground block text-sm">
            Quién está en turno, quién faltó y quién llegó tarde.
          </span>
        </span>
        <ChevronRightIcon
          aria-hidden
          className="text-muted-foreground size-5"
        />
      </Link>

      <Link
        className="workia-pass-card flex items-center justify-between gap-3 px-5 py-4"
        href="/mi/equipo/aprobaciones"
      >
        <span className="space-y-0.5">
          <span className="block text-base font-semibold">Aprobaciones</span>
          <span className="text-muted-foreground block text-sm">
            Vacaciones, permisos y lo que espera tu decisión.
          </span>
        </span>
        <ChevronRightIcon
          aria-hidden
          className="text-muted-foreground size-5"
        />
      </Link>

      <section aria-labelledby="mi-equipo-lista" className="space-y-2">
        <h2 className="text-base font-semibold" id="mi-equipo-lista">
          Personas
        </h2>
        {team.items.length > 0 ? (
          <ul className="workia-pass-card divide-y" data-testid="team-list">
            {team.items.map((member) => (
              <li key={member.id}>
                <Link
                  className="flex min-h-14 items-center justify-between gap-3 px-5 py-3"
                  href={`/mi/equipo/${member.id}`}
                >
                  <span className="min-w-0 space-y-0.5">
                    <span className="block font-medium break-words">
                      {member.name}
                    </span>
                    <span className="text-muted-foreground block text-sm break-words">
                      {[member.positionName, member.siteName ?? member.areaName]
                        .filter(Boolean)
                        .join(" · ") || "Sin puesto capturado"}
                      {member.managerName
                        ? ` · Reporta a ${member.managerName}`
                        : ""}
                    </span>
                  </span>
                  <ChevronRightIcon
                    aria-hidden
                    className="text-muted-foreground size-4 shrink-0"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="workia-empty-state text-muted-foreground px-5 py-4 text-sm">
            {cursor
              ? "No hay más personas."
              : "Nadie te reporta todavía. RH asigna el jefe en el expediente de cada persona."}
          </p>
        )}
        {team.next ? (
          <Link
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            href={`/mi/equipo?cursor=${encodeURIComponent(team.next)}`}
          >
            Ver más
          </Link>
        ) : null}
      </section>

      {own ? (
        <section
          aria-labelledby="mi-equipo-suplente"
          className="workia-pass-card space-y-3 px-5 py-4"
        >
          <div className="space-y-1">
            <h2 className="text-base font-semibold" id="mi-equipo-suplente">
              Suplente
            </h2>
            <p className="text-muted-foreground text-sm">
              Mientras faltas, tu suplente ve a tu equipo y decide tus
              aprobaciones. Termina sola el último día.
            </p>
          </div>
          <DelegationControls
            candidates={candidates}
            delegations={delegations}
            today={isoToday()}
          />
        </section>
      ) : null}
    </main>
  );
};

export default TeamPage;
