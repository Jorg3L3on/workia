import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { GroupDashboard } from "@/components/reports/group/group-dashboard";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { isoToday } from "@/lib/format/date";
import { getGroupDashboard, loadGroupReportReader } from "@/lib/reports/group";
import { GROUP_URL_PARAM, parseGroupParam } from "@/lib/reports/group/url";
import { requireCompanyPage } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.grupo,
};

type GrupoPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Reportes → Grupo (Workia 2.0 W2-25): every subsidiary where the user has
 * reports:read, or all of them with the group admin grant, side by side.
 * Each company is read under its own row-level security.
 */
const GrupoPage = async ({ searchParams }: GrupoPageProps) => {
  const session = await requireCompanyPage();
  const reader = await loadGroupReportReader(session.user.id);

  if (reader.companies.length === 0) {
    forbidden();
  }

  const today = isoToday();
  const filter = parseGroupParam((await searchParams)[GROUP_URL_PARAM], today);
  const dashboard = await getGroupDashboard(reader, filter, today);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Plantilla, rotación y ausentismo de cada empresa del grupo, por región y sucursal, con los números de sus propios reportes."
        title="Tablero del grupo"
      />
      <GroupDashboard
        activeCompanyId={session.companyId}
        companyOptions={reader.companies.map((company) => ({
          value: company.id,
          label: company.name,
        }))}
        dashboard={dashboard}
        today={today}
      />
    </div>
  );
};

export default GrupoPage;
