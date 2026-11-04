import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { AbsenteeismDashboard } from "@/components/reports/absenteeism/absenteeism-dashboard";
import { AbsenteeismToolbar } from "@/components/reports/absenteeism/absenteeism-toolbar";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { isoToday } from "@/lib/format/date";
import { getAbsenteeismReport } from "@/lib/reports/absenteeism";
import {
  ABSENTEEISM_URL_PARAM,
  parseAbsenteeismParam,
} from "@/lib/reports/absenteeism/url";
import { listAbsenteeismViews } from "@/lib/reports/absenteeism/views";
import { requireCompanyPage } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.ausentismo,
};

type AusentismoPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, "es");

/**
 * Reportes → Ausentismo y rotación (Workia 2.0 W2-20): reports:read. The
 * company is one subsidiary; the table goes by región and sucursal.
 */
const AusentismoPage = async ({ searchParams }: AusentismoPageProps) => {
  const session = await requireCompanyPage();
  const { companyId, permissions } = session;

  if (!permissions.has("reports:read")) {
    forbidden();
  }

  const today = isoToday();
  const filter = parseAbsenteeismParam(
    (await searchParams)[ABSENTEEISM_URL_PARAM],
    today,
  );
  const [report, views] = await Promise.all([
    getAbsenteeismReport(companyId, filter, today),
    listAbsenteeismViews(companyId, session.user.id, today),
  ]);
  const { sites, regions } = report.structure;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Faltas, retardos y bajas de cada región y sucursal, con la misma rotación que el reporte de Rotación."
        primary={
          <AbsenteeismToolbar
            canExportPeople={
              permissions.has("people:export") && permissions.has("people:read")
            }
            companyId={companyId}
            filter={filter}
            today={today}
            views={views}
          />
        }
        title="Ausentismo y rotación"
      />
      <AbsenteeismDashboard
        options={{
          regions: regions
            .map((region) => ({ value: region.id, label: region.name }))
            .sort((a, b) => byLabel(a, b)),
          sites: sites
            .filter((site) => !site.deleted)
            .map((site) => ({ value: site.id, label: site.name }))
            .sort((a, b) => byLabel(a, b)),
        }}
        report={report}
        today={today}
      />
    </div>
  );
};

export default AusentismoPage;
