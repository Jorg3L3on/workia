import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { TeamPageHeader } from "@/components/manager/team-page-header";
import { CancelRequestButton } from "@/components/requests/cancel-request-button";
import { RequestStatusBadge } from "@/components/requests/request-status-badge";
import { Button } from "@/components/ui/button";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { formatDateMx, isoToday } from "@/lib/format/date";
import {
  canCancel,
  listMyRequests,
  TIME_OFF_KIND_LABELS,
} from "@/lib/requests";
import {
  formatSignedVacationDays,
  formatVacationDays,
} from "@/lib/vacations/balance";
import { getPersonVacationBalance } from "@/lib/vacations/person-balance";

export const metadata: Metadata = { title: "Mis solicitudes" };

type MyRequestsPageProps = {
  searchParams: Promise<{ cursor?: string | string[]; enviada?: string }>;
};

/**
 * «Mis solicitudes» (W2-06): the employee's vacaciones and permisos, newest
 * first, with what is left of this service year's vacation days. Everything
 * comes from the session's person.
 */
const MyRequestsPage = async ({ searchParams }: MyRequestsPageProps) => {
  const context = await requireEmployeeContext();
  const { cursor, enviada } = await searchParams;
  const today = isoToday();
  const [page, balance] = await Promise.all([
    listMyRequests(context, {
      cursor: typeof cursor === "string" ? cursor : null,
    }),
    getPersonVacationBalance(context.companyId, context.personId, today),
  ]);
  const current = balance?.current ?? null;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-6 pb-10">
      <TeamPageHeader
        backHref="/mi"
        backLabel="Inicio"
        title="Mis solicitudes"
        subtitle="Vacaciones y permisos. Tu jefe las aprueba; si no tienes jefe en la app, RH."
      />

      {enviada ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Solicitud enviada. Te avisamos cuando la decidan.
        </p>
      ) : null}

      <section className="workia-pass-card flex items-center justify-between gap-3 px-5 py-4">
        <div className="space-y-0.5">
          <p className="workia-field-label">Vacaciones que te quedan</p>
          <p className="text-lg font-semibold" data-testid="vacation-left">
            {current
              ? formatSignedVacationDays(current.remainingHalves)
              : "Sin cálculo"}
          </p>
          {current ? (
            <p className="text-muted-foreground text-xs">
              De {current.entitlementDays} días de este año de servicio. Una
              solicitud las descuenta cuando la aprueban.
            </p>
          ) : null}
        </div>
        <Button asChild size="lg">
          <Link href="/mi/solicitudes/nueva">
            <PlusIcon aria-hidden className="size-4" />
            Pedir
          </Link>
        </Button>
      </section>

      {page.items.length > 0 ? (
        <ul className="workia-pass-card divide-y" data-testid="my-requests">
          {page.items.map((request) => (
            <li className="space-y-1.5 px-5 py-3" key={request.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {TIME_OFF_KIND_LABELS[request.kind]}
                </span>
                <RequestStatusBadge status={request.status} />
              </div>
              <p className="text-muted-foreground text-sm">
                {request.startDate === request.endDate
                  ? formatDateMx(request.startDate)
                  : `${formatDateMx(request.startDate)} al ${formatDateMx(request.endDate)}`}{" "}
                · {formatVacationDays(request.days)}
                {request.status === "pending"
                  ? ` · la decide ${request.approverName ?? "RH"}`
                  : null}
              </p>
              {request.status === "rejected" && request.decisionReason ? (
                <p className="text-sm">Motivo: {request.decisionReason}</p>
              ) : null}
              {canCancel(request, today) ? (
                <CancelRequestButton requestId={request.id} />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="workia-empty-state text-muted-foreground px-5 py-4 text-sm">
          Todavía no has pedido vacaciones ni permisos.
        </p>
      )}
      {page.next ? (
        <Link
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          href={`/mi/solicitudes?cursor=${encodeURIComponent(page.next)}`}
        >
          Ver más
        </Link>
      ) : null}
    </main>
  );
};

export default MyRequestsPage;
