import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { JustificationForm } from "@/components/incidencias/justification-form";
import { ReasonDialog } from "@/components/incidencias/reason-dialog";
import { PayPeriodStatusBadge } from "@/components/pay-periods/pay-periods-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { localTime } from "@/lib/attendance/time";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { formatDateMx, isoToday } from "@/lib/format/date";
import {
  getPersonPeriodIncidencias,
  listJustifications,
  type PersonDayIncidencia,
} from "@/lib/incidencias";
import {
  cancelJustificationAction,
  createJustificationAction,
  overrideIncidenciaAction,
} from "@/lib/incidencias/actions";
import {
  incidenciaLabel,
  INCIDENCIAS_COPY,
  justificationKindLabel,
  justificationRefLabel,
} from "@/lib/incidencias/copy";
import { getPayPeriod, isQuincena, quincenaLabel } from "@/lib/pay-periods";
import { requirePayPeriodsRead } from "@/lib/pay-periods/auth";
import { formatPersonName } from "@/lib/people/schema";
import { toneFor } from "@/lib/ui/status-tone";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.periodo,
};

type Props = { params: Promise<{ period: string; personId: string }> };

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * One person's quincena (W2-14): the incidencias the engine wrote, the
 * punches of each day, and HR's decisions: justify or void one incidencia,
 * register a permiso or an incapacidad, cancel one. Changes need
 * pay_periods:manage and an open quincena.
 */
const PersonPeriodPage = async ({ params }: Props) => {
  const session = await requirePayPeriodsRead();
  const { period, personId } = await params;

  if (!isQuincena(period) || !UUID.test(personId)) notFound();

  const detail = await getPersonPeriodIncidencias(
    session.companyId,
    period,
    personId,
  );

  if (!detail) notFound();

  const [payPeriod, justifications] = await Promise.all([
    getPayPeriod(session.companyId, period),
    listJustifications(session.companyId, personId, detail.range),
  ]);
  const status = payPeriod?.status ?? "open";
  const canManage =
    session.permissions.has("pay_periods:manage") && status === "open";
  const name = formatPersonName(detail.person);
  const today = isoToday();
  const defaultDay =
    today >= detail.range.from && today <= detail.range.to
      ? today
      : detail.range.from;
  const time = (value: string | null | undefined) =>
    value ? localTime(new Date(value)) : "—";

  const punchesText = (day: string) => {
    const punches = detail.punches[day];

    return punches
      ? `${time(punches.first)} – ${time(punches.last)}`
      : "Sin checadas";
  };
  const statusBadge = (row: PersonDayIncidencia) =>
    row.voided ? (
      <Badge tone={toneFor("incidencia", "voided")}>Anulada</Badge>
    ) : row.justified ? (
      <Badge tone={toneFor("incidencia", "justified")}>
        {justificationRefLabel(row.justificationRef) ?? "Justificada"}
      </Badge>
    ) : (
      <Badge tone={toneFor("incidencia", "pending")}>Sin justificar</Badge>
    );
  const decisions = (row: PersonDayIncidencia) => {
    const kindLabel = incidenciaLabel(row.kind);
    const day = formatDateMx(row.day);
    const fields = { personId, day: row.day, kind: row.kind };

    return (
      <>
        {!row.justified && !row.voided ? (
          <ReasonDialog
            action={overrideIncidenciaAction}
            description={`${kindLabel} del ${day}. Queda justificada en la pre-nómina y en la bitácora.`}
            fields={{ ...fields, effect: "justify" }}
            label={INCIDENCIAS_COPY.justify}
            testId={`justify-${row.day}-${row.kind}`}
            title={`${INCIDENCIAS_COPY.justify} ${kindLabel.toLowerCase()}`}
          />
        ) : null}
        {!row.voided ? (
          <ReasonDialog
            action={overrideIncidenciaAction}
            description={`${kindLabel} del ${day}. Deja de contar; la decisión queda en la bitácora.`}
            destructive
            fields={{ ...fields, effect: "void" }}
            label={INCIDENCIAS_COPY.void}
            testId={`void-${row.day}-${row.kind}`}
            title={`${INCIDENCIAS_COPY.void} ${kindLabel.toLowerCase()}`}
          />
        ) : null}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageBreadcrumbLabel label={name} />
      <PageHeader
        description={
          status === "closed"
            ? INCIDENCIAS_COPY.closedNote
            : `${formatDateMx(detail.range.from)} al ${formatDateMx(detail.range.to)}`
        }
        status={<PayPeriodStatusBadge status={status} />}
        title={`${name} · ${quincenaLabel(period)}`}
        variant="detail"
      />
      <Card>
        <CardHeader>
          <CardTitle>{INCIDENCIAS_COPY.incidenciasTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.incidencias.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {INCIDENCIAS_COPY.noIncidencias}
            </p>
          ) : (
            <>
              <ul className="divide-y md:hidden">
                {detail.incidencias.map((row) => (
                  <li
                    className="flex flex-col gap-2 py-3"
                    key={`${row.day}-${row.kind}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {formatDateMx(row.day)} · {incidenciaLabel(row.kind)}
                        {row.minutes ? ` · ${row.minutes} min` : ""}
                      </p>
                      {statusBadge(row)}
                    </div>
                    <p className="text-muted-foreground text-sm tabular-nums">
                      {punchesText(row.day)}
                    </p>
                    {canManage ? (
                      <div className="flex gap-2">{decisions(row)}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Table
                className="hidden md:table"
                data-testid="person-incidencias"
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>Día</TableHead>
                    <TableHead>Incidencia</TableHead>
                    <TableHead className="text-right">Minutos</TableHead>
                    <TableHead>Checadas</TableHead>
                    <TableHead>Estado</TableHead>
                    {canManage ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.incidencias.map((row) => (
                    <TableRow
                      data-testid="person-incidencia-row"
                      key={`${row.day}-${row.kind}`}
                    >
                      <TableCell>{formatDateMx(row.day)}</TableCell>
                      <TableCell>{incidenciaLabel(row.kind)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.minutes ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {punchesText(row.day)}
                      </TableCell>
                      <TableCell>{statusBadge(row)}</TableCell>
                      {canManage ? (
                        <TableCell className="space-x-2 text-right whitespace-nowrap">
                          {decisions(row)}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{INCIDENCIAS_COPY.justificationsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {justifications.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {INCIDENCIAS_COPY.noJustifications}
            </p>
          ) : (
            <ul className="divide-y" data-testid="person-justifications">
              {justifications.map((row) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  key={row.id}
                >
                  <div className="text-sm">
                    <p className={row.cancelledAt ? "line-through" : undefined}>
                      {justificationKindLabel[row.kind]}
                      {row.incidenciaKind
                        ? ` · ${incidenciaLabel(row.incidenciaKind)} ${row.effect === "void" ? "anulada" : "justificada"}`
                        : ""}{" "}
                      · {formatDateMx(row.fromDay)}
                      {row.toDay !== row.fromDay
                        ? ` al ${formatDateMx(row.toDay)}`
                        : ""}
                      {row.reference ? ` · ${row.reference}` : ""}
                    </p>
                    <p className="text-muted-foreground">
                      {row.cancelledAt
                        ? `Cancelada: ${row.cancelReason}`
                        : row.reason}
                    </p>
                  </div>
                  {canManage && !row.cancelledAt ? (
                    <ReasonDialog
                      action={cancelJustificationAction}
                      description="Las incidencias de esos días se recalculan sin ella."
                      destructive
                      fields={{ id: row.id }}
                      label={INCIDENCIAS_COPY.cancel}
                      testId={`cancel-${row.id}`}
                      title={INCIDENCIAS_COPY.cancel}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <JustificationForm
              action={createJustificationAction}
              defaultDay={defaultDay}
              personId={personId}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default PersonPeriodPage;
