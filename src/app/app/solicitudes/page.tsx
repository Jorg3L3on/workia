import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { RequestStatusBadge } from "@/components/requests/request-status-badge";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { formatDateMx } from "@/lib/format/date";
import {
  decidedNotice,
  listCompanyRequests,
  TIME_OFF_KIND_LABELS,
  TIME_OFF_STATUS_LABELS,
  type CompanyRequestFilter,
} from "@/lib/requests";
import { requireCompanyPage } from "@/lib/tenant/context";
import { formatVacationDays } from "@/lib/vacations/balance";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: pageTitles.solicitudes };

type HrRequestsPageProps = {
  searchParams: Promise<{
    estado?: string | string[];
    cursor?: string | string[];
    decidida?: string | string[];
    exceso?: string | string[];
  }>;
};

/** The filters, in the order the tabs show them. "rh" is what HR decides itself. */
const FILTERS = [
  { key: "pendientes", label: "Pendientes", filter: { status: "pending" } },
  {
    key: "rh",
    label: "Las decide RH",
    filter: { status: "pending", hrOnly: true },
  },
  { key: "aprobadas", label: "Aprobadas", filter: { status: "approved" } },
  { key: "rechazadas", label: "Rechazadas", filter: { status: "rejected" } },
  { key: "canceladas", label: "Canceladas", filter: { status: "cancelled" } },
  { key: "todas", label: "Todas", filter: {} },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  filter: CompanyRequestFilter;
}>;

const one = (value?: string | string[]) =>
  typeof value === "string" ? value : undefined;

/**
 * HR's view of every request of the company (W2-06), newest first, in keyset
 * pages. vacations:read to see them; deciding needs vacations:update.
 */
const HrRequestsPage = async ({ searchParams }: HrRequestsPageProps) => {
  const session = await requireCompanyPage();

  if (!session.permissions.has("vacations:read")) {
    forbidden();
  }

  const params = await searchParams;
  const notice = decidedNotice(params);
  const active =
    FILTERS.find((entry) => entry.key === one(params.estado)) ?? FILTERS[0];
  const page = await listCompanyRequests(session.companyId, active.filter, {
    cursor: one(params.cursor) ?? null,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Vacaciones y permisos que pidió el personal desde la app. Las de quien no tiene jefe en la app las decide RH."
        title={pageTitles.solicitudes}
      />
      {notice ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          {notice}
        </p>
      ) : null}
      <nav aria-label="Filtrar solicitudes" className="flex flex-wrap gap-2">
        {FILTERS.map((entry) => (
          <Link
            aria-current={entry.key === active.key ? "page" : undefined}
            className={
              entry.key === active.key
                ? "bg-primary text-primary-foreground rounded-full px-3 py-1 text-sm font-medium"
                : "text-muted-foreground hover:bg-muted rounded-full px-3 py-1 text-sm"
            }
            href={`/app/solicitudes?estado=${entry.key}`}
            key={entry.key}
          >
            {entry.label}
          </Link>
        ))}
      </nav>
      {page.items.length > 0 ? (
        <ul className="divide-y rounded-lg border" data-testid="hr-requests">
          {page.items.map((request) => (
            <li key={request.id}>
              <Link
                className="hover:bg-muted/50 flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                href={`/app/solicitudes/${request.id}`}
              >
                <span className="space-y-0.5">
                  <span className="block font-medium">
                    {request.personName}
                  </span>
                  <span className="text-muted-foreground block text-sm">
                    {TIME_OFF_KIND_LABELS[request.kind]} ·{" "}
                    {request.startDate === request.endDate
                      ? formatDateMx(request.startDate)
                      : `${formatDateMx(request.startDate)} al ${formatDateMx(request.endDate)}`}{" "}
                    · {formatVacationDays(request.days)} · decide{" "}
                    {request.approverName ?? "RH"}
                  </span>
                </span>
                <RequestStatusBadge status={request.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          No hay solicitudes{" "}
          {active.key === "todas"
            ? ""
            : TIME_OFF_STATUS_LABELS[
                (active.filter as CompanyRequestFilter).status ?? "pending"
              ].toLowerCase() + "s"}
          .
        </p>
      )}
      {page.next ? (
        <Link
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          href={`/app/solicitudes?estado=${active.key}&cursor=${encodeURIComponent(page.next)}`}
        >
          Ver más
        </Link>
      ) : null}
    </div>
  );
};

export default HrRequestsPage;
