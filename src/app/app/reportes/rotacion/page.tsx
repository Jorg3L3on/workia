import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { TurnoverDashboard } from "@/components/reports/turnover/turnover-dashboard";
import { TurnoverToolbar } from "@/components/reports/turnover/turnover-toolbar";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { isoToday } from "@/lib/format/date";
import { getTurnoverReport } from "@/lib/reports/turnover";
import {
  parseTurnoverParam,
  TURNOVER_URL_PARAM,
} from "@/lib/reports/turnover/url";
import { listTurnoverViews } from "@/lib/reports/turnover/views";
import { requireCompanyPage } from "@/lib/tenant/context";
import { listTerminationReasons } from "@/lib/termination-reasons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.rotacion,
};

type RotacionPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const toOptions = (names: Record<string, string>) =>
  Object.entries(names)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));

/**
 * Reportes → Rotación (WRK-I12): reports:read. The people behind each number
 * travel only with people:read; the goal is edited with settings:update.
 */
const RotacionPage = async ({ searchParams }: RotacionPageProps) => {
  const session = await requireCompanyPage();
  const { companyId, permissions } = session;

  if (!permissions.has("reports:read")) {
    forbidden();
  }

  const today = isoToday();
  const filter = parseTurnoverParam(
    (await searchParams)[TURNOVER_URL_PARAM],
    today,
  );
  const [{ report, labels }, reasons, views] = await Promise.all([
    getTurnoverReport(companyId, filter, {
      withDetail: permissions.has("people:read"),
      today,
    }),
    listTerminationReasons(companyId),
    listTurnoverViews(companyId, session.user.id, today),
  ]);
  const canExport =
    permissions.has("people:export") && permissions.has("people:read");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Cuánta gente se va, de dónde, por qué y cuántos no pasan la prueba de 90 días."
        primary={
          <TurnoverToolbar
            canExport={canExport}
            canExportPdf={false}
            companyId={companyId}
            filter={filter}
            today={today}
            views={views}
          />
        }
        title="Rotación"
      />
      <TurnoverDashboard
        canEditGoal={permissions.has("settings:update")}
        canImport={permissions.has("people:import")}
        canManageReasons={permissions.has("settings:update")}
        companyId={companyId}
        options={{
          areas: toOptions(labels.areas),
          sites: toOptions(labels.sites),
          positions: toOptions(labels.positions),
          managers: toOptions(labels.managers),
          reasons: reasons.map((reason) => ({
            value: reason.id,
            label: reason.name,
          })),
        }}
        report={report}
      />
    </div>
  );
};

export default RotacionPage;
