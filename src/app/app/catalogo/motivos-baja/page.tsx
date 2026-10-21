import type { Metadata } from "next";

import { MotivosBajaCatalog } from "@/components/catalog/catalog-entities";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { userHasPermission } from "@/lib/rbac";
import { listTerminationReasonsWithUsage } from "@/lib/termination-reasons";
import { requireTerminationReasonsRead } from "@/lib/termination-reasons/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.motivosBaja,
};

type MotivosBajaCatalogPageProps = {
  searchParams: Promise<{ error?: string; saved?: string; deleted?: string }>;
};

/** Motivos de baja (Iniciativa 2): read with people:read, edited with settings:update. */
const MotivosBajaCatalogPage = async ({
  searchParams,
}: MotivosBajaCatalogPageProps) => {
  const session = await requireTerminationReasonsRead();
  const { error, saved, deleted } = await searchParams;

  const [reasons, canManage] = await Promise.all([
    listTerminationReasonsWithUsage(session.companyId),
    userHasPermission(session.user.id, "settings:update"),
  ]);

  return (
    <MotivosBajaCatalog
      canCreate={canManage}
      canDelete={canManage}
      canUpdate={canManage}
      notice={
        <CatalogStatusMessages deleted={deleted} error={error} saved={saved} />
      }
      rows={reasons.map((reason) => ({
        id: reason.id,
        name: reason.name,
        active: reason.active,
        useCount: reason.useCount,
        references: [{ count: reason.useCount, one: "baja", many: "bajas" }],
      }))}
    />
  );
};

export default MotivosBajaCatalogPage;
