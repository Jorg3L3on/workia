import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { PayPeriodActions } from "@/components/pay-periods/pay-period-actions";
import { PayPeriodStatusBadge } from "@/components/pay-periods/pay-periods-table";
import { PeriodPeopleTable } from "@/components/pay-periods/period-people-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { formatDateMx, formatDateTimeMx } from "@/lib/format/date";
import {
  getPayPeriodDetail,
  isQuincena,
  verifyPeriodSnapshot,
} from "@/lib/pay-periods";
import {
  closePayPeriodAction,
  reopenPayPeriodAction,
} from "@/lib/pay-periods/actions";
import { requirePayPeriodsRead } from "@/lib/pay-periods/auth";
import {
  incidenciaKindLabel,
  orderedKinds,
  PAY_PERIOD_COPY,
} from "@/lib/pay-periods/copy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.periodo,
};

type PeriodoPageProps = {
  params: Promise<{ period: string }>;
  searchParams: Promise<{ desde?: string }>;
};

/**
 * One quincena (W2-15): its status, its incidencias by person (the frozen
 * snapshot once closed, the live aggregate while open), close and reopen with
 * pay_periods:manage, and the check that the snapshot still matches
 * person_events.
 */
const PeriodoPage = async ({ params, searchParams }: PeriodoPageProps) => {
  const session = await requirePayPeriodsRead();
  const { period } = await params;

  if (!isQuincena(period)) {
    notFound();
  }

  const { desde } = await searchParams;
  const [detail, check] = await Promise.all([
    getPayPeriodDetail(session.companyId, period, { cursor: desde ?? null }),
    verifyPeriodSnapshot(session.companyId, period),
  ]);
  const canManage = session.permissions.has("pay_periods:manage");
  const kinds = orderedKinds(Object.keys(detail.totals));
  const meta = [
    `${formatDateMx(detail.startsOn)} al ${formatDateMx(detail.endsOn)}`,
    detail.closedAt
      ? `cerrada el ${formatDateTimeMx(detail.closedAt)} · revisión ${detail.revision}`
      : detail.revision > 0
        ? `reabierta · ${detail.revision} ${detail.revision === 1 ? "cierre previo" : "cierres previos"}`
        : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumbLabel label={detail.label} />
      <PageHeader
        description={
          detail.source === "snapshot"
            ? PAY_PERIOD_COPY.frozen
            : PAY_PERIOD_COPY.live
        }
        meta={meta}
        primary={
          canManage ? (
            <PayPeriodActions
              closeAction={closePayPeriodAction}
              label={detail.label}
              period={detail.period}
              reopenAction={reopenPayPeriodAction}
              status={detail.status}
            />
          ) : null
        }
        status={<PayPeriodStatusBadge status={detail.status} />}
        title={detail.label}
        variant="detail"
      />
      {check ? (
        <p
          className={
            check.matches ? "text-muted-foreground text-sm" : "text-sm"
          }
          data-testid="pay-period-check"
          role="status"
        >
          {check.matches
            ? PAY_PERIOD_COPY.matches
            : PAY_PERIOD_COPY.differs(check.differences.length)}
        </p>
      ) : null}
      {kinds.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {kinds.map((kind) => {
            const total = detail.totals[kind];

            return (
              <Card data-testid={`pay-period-total-${kind}`} key={kind}>
                <CardHeader>
                  <CardTitle>{incidenciaKindLabel(kind)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className="text-2xl font-semibold tabular-nums">
                    {total.count.toLocaleString("es-MX")}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {total.justified.toLocaleString("es-MX")} justificadas
                    {kind !== "falta" && total.minutes > 0
                      ? ` · ${total.minutes.toLocaleString("es-MX")} min`
                      : ""}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}
      <PeriodPeopleTable
        emptyTitle={PAY_PERIOD_COPY.empty}
        kinds={kinds}
        rows={detail.people}
      />
      {detail.next ? (
        <div>
          <Button asChild variant="secondary">
            <Link href={`/app/periodos/${detail.period}?desde=${detail.next}`}>
              {PAY_PERIOD_COPY.morePeople}
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default PeriodoPage;
