import type { Metadata } from "next";

import {
  AreasCatalog,
  type AreaCatalogRow,
} from "@/components/catalog/catalog-entities";
import { CatalogStatusMessages } from "@/components/catalog/catalog-status-messages";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { countCatalogReferences, listAreas } from "@/lib/catalog";
import { requireAreasRead } from "@/lib/catalog/auth";
import { buildAreaTree, type AreaTreeNode } from "@/lib/catalog/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.areas,
};

type AreasCatalogPageProps = {
  searchParams: Promise<{ error?: string; saved?: string; deleted?: string }>;
};

const subtreeIds = (node: AreaTreeNode): string[] => [
  node.id,
  ...node.children.flatMap(subtreeIds),
];

const AreasCatalogPage = async ({ searchParams }: AreasCatalogPageProps) => {
  const session = await requireAreasRead();
  const { error, saved, deleted } = await searchParams;

  const [areas, references, canCreate, canUpdate, canDelete] =
    await Promise.all([
      listAreas(session.companyId),
      countCatalogReferences(session.companyId),
      userHasPermission(session.user.id, "areas:create"),
      userHasPermission(session.user.id, "areas:update"),
      userHasPermission(session.user.id, "areas:delete"),
    ]);

  // The tree, flattened in order with each area's level.
  const rows: AreaCatalogRow[] = [];
  const visit = (nodes: AreaTreeNode[], depth: number) => {
    for (const node of nodes) {
      const positionCount = references.positionsByArea.get(node.id) ?? 0;

      rows.push({
        id: node.id,
        name: node.name,
        active: node.active,
        parentAreaId: node.parentAreaId,
        depth,
        subtreeIds: subtreeIds(node),
        positionCount,
        references: [
          {
            count: references.peopleByArea.get(node.id) ?? 0,
            one: "persona",
            many: "personas",
          },
          { count: positionCount, one: "puesto", many: "puestos" },
          {
            count: references.childAreas.get(node.id) ?? 0,
            one: "sub-área",
            many: "sub-áreas",
          },
        ],
      });
      visit(node.children, depth + 1);
    }
  };
  visit(buildAreaTree(areas), 0);

  return (
    <AreasCatalog
      canCreate={canCreate}
      canDelete={canDelete}
      canUpdate={canUpdate}
      notice={
        <CatalogStatusMessages deleted={deleted} error={error} saved={saved} />
      }
      parents={areas
        .filter((area) => area.active)
        .map((area) => ({ id: area.id, name: area.name }))}
      rows={rows}
    />
  );
};

export default AreasCatalogPage;
