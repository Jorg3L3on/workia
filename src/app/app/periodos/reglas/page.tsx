import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { IncidenciaRulesForm } from "@/components/incidencias/rules-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { formatDateTimeMx, isoToday } from "@/lib/format/date";
import {
  firstPeriodForChange,
  getIncidenciaRules,
  listIncidenciaRules,
} from "@/lib/incidencias";
import { saveIncidenciaRulesAction } from "@/lib/incidencias/actions";
import { INCIDENCIAS_COPY } from "@/lib/incidencias/copy";
import { quincenaLabel, quincenaOf } from "@/lib/pay-periods";
import { requirePayPeriodsRead } from "@/lib/pay-periods/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.reglasIncidencias,
};

const minutesText = (value: number | null) =>
  value === null ? "—" : `${value} min`;

/**
 * The company's incidencias rules (W2-14): the tolerances in effect now, the
 * form for the next quincena (pay_periods:manage) and the past changes.
 */
const ReglasPage = async () => {
  const session = await requirePayPeriodsRead();
  const today = isoToday();
  const next = firstPeriodForChange(today);
  const [current, upcoming, history] = await Promise.all([
    getIncidenciaRules(session.companyId, quincenaOf(today)),
    getIncidenciaRules(session.companyId, next),
    listIncidenciaRules(session.companyId),
  ]);
  const canManage = session.permissions.has("pay_periods:manage");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={INCIDENCIAS_COPY.rulesDescription}
        meta={INCIDENCIAS_COPY.rulesInEffect(current.effectivePeriod)}
        title={INCIDENCIAS_COPY.rulesTitle}
        variant="detail"
      />
      <Card>
        <CardHeader>
          <CardTitle>
            {canManage
              ? `Desde la ${quincenaLabel(next)}`
              : `En vigor en la ${quincenaLabel(quincenaOf(today))}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <IncidenciaRulesForm
            action={saveIncidenciaRulesAction}
            disabled={!canManage}
            rules={canManage ? upcoming : current}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{INCIDENCIAS_COPY.history}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {INCIDENCIAS_COPY.noHistory}
            </p>
          ) : (
            <ul
              className="divide-y text-sm"
              data-testid="incidencia-rules-history"
            >
              {history.map((row) => (
                <li className="py-2" key={row.effectivePeriod}>
                  <p>
                    Desde la {quincenaLabel(row.effectivePeriod)}: entrada{" "}
                    {minutesText(row.retardoToleranceMinutes)}, salida{" "}
                    {minutesText(row.salidaToleranceMinutes)}, falta después de{" "}
                    {minutesText(row.faltaAfterMinutes)}
                  </p>
                  <p className="text-muted-foreground">
                    Guardado el {formatDateTimeMx(row.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ReglasPage;
