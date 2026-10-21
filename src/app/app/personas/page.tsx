import type { Metadata } from "next";
import Link from "next/link";
import { FileDownIcon, HistoryIcon, PlusIcon, UploadIcon } from "lucide-react";

import { pageTitles } from "@/lib/brand/chrome-copy";

import { PageHeader } from "@/components/layout/page-header";
import { PersonasDataTable } from "@/components/people/personas-data-table";
import { Button } from "@/components/ui/button";
import { listAreas, listPositions } from "@/lib/catalog";
import type { PermissionSlug } from "@/lib/db/schema/types";
import { isoToday } from "@/lib/format/date";
import { assertPeopleListAccess } from "@/lib/people/actions";
import {
  allowedPeopleColumns,
  coercePeopleColumns,
  DEFAULT_PEOPLE_COLUMNS,
} from "@/lib/people/filter/columns";
import { allowedPeopleFilterFields } from "@/lib/people/filter/fields";
import { peopleFilterContext } from "@/lib/people/filter/query";
import { conditionFor, restrictPeopleFilter } from "@/lib/people/filter/schema";
import {
  parsePeopleListParams,
  type PeopleSearchParams,
} from "@/lib/people/filter/url";
import {
  listPeopleFiltered,
  listPeopleNamesByIds,
  peopleColumnValue,
} from "@/lib/people/list";
import { formatPersonName } from "@/lib/people/schema";
import { listPeopleViews } from "@/lib/people/views";
import { listRegions } from "@/lib/regions";
import { listSites } from "@/lib/sites";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.personas,
};

type PersonasPageProps = {
  searchParams: Promise<PeopleSearchParams>;
};

const toOptions = (rows: { id: string; name: string }[]) =>
  rows.map((row) => ({ value: row.id, label: row.name }));

/**
 * Personas: the filter, the saved view and the visible columns come from the
 * URL (old `q`/`status`/`deleted`/`region` links included). A view's own
 * filter applies only when the URL carries none: the URL always wins.
 */
const PersonasPage = async ({ searchParams }: PersonasPageProps) => {
  const session = await assertPeopleListAccess();
  const { companyId, permissions } = session;
  const parsed = parsePeopleListParams(await searchParams);
  const views = await listPeopleViews(companyId, {
    userId: session.user.id,
    permissions,
  });
  const activeView = views.find((view) => view.id === parsed.viewId) ?? null;
  const filter = restrictPeopleFilter(
    parsed.hasFilterParams || !activeView ? parsed.filter : activeView.filter,
    permissions,
  );
  const columns =
    parsed.columns !== null
      ? coercePeopleColumns(parsed.columns, permissions)
      : activeView
        ? activeView.columns
        : coercePeopleColumns(DEFAULT_PEOPLE_COLUMNS, permissions);
  const today = isoToday();
  const managerIds = conditionFor(filter, "jefe")?.values ?? [];

  const [
    { rows: people, total },
    regions,
    areaRows,
    positionRows,
    siteRows,
    managers,
  ] = await Promise.all([
    listPeopleFiltered(companyId, {
      filter,
      context: peopleFilterContext(permissions, today),
      columns,
      page: parsed.page,
      pageSize: parsed.pageSize,
    }),
    listRegions(companyId),
    listAreas(companyId),
    listPositions(companyId),
    listSites(companyId),
    listPeopleNamesByIds(companyId, managerIds),
  ]);
  const can = (permission: PermissionSlug) => permissions.has(permission);
  // Región only shows up once the company has regions (or the URL uses it).
  const fields = allowedPeopleFilterFields(permissions).filter(
    (field) =>
      field.id !== "region" ||
      regions.length > 0 ||
      Boolean(conditionFor(filter, "region")),
  );

  const rows = people.map((person) => ({
    id: person.id,
    name: formatPersonName(person),
    status: person.status,
    deleted: Boolean(person.deletedAt),
    cells: Object.fromEntries(
      columns.map((id) => [id, peopleColumnValue(person, id)]),
    ),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Expedientes, relación laboral e identificadores."
        menu={[
          can("people:import") && {
            label: "Descargar plantilla",
            icon: FileDownIcon,
            href: "/app/personas/plantilla",
            download: true,
          },
          can("people:import") && {
            label: "Historial de importaciones",
            icon: HistoryIcon,
            href: "/app/personas/importaciones",
          },
        ]}
        primary={
          can("people:create")
            ? {
                label: "Nueva persona",
                icon: PlusIcon,
                href: "/app/personas/nueva",
              }
            : null
        }
        secondary={
          can("people:import")
            ? {
                label: "Importar",
                icon: UploadIcon,
                href: "/app/personas/importar",
              }
            : null
        }
        title="Personas"
      />

      <PersonasDataTable
        activeViewId={activeView?.id ?? null}
        allowedColumns={allowedPeopleColumns(permissions)}
        canExport={can("people:export")}
        canReadContracts={can("contracts:read")}
        canUpdate={can("people:update")}
        columns={columns}
        emptyAction={
          can("people:create") ? (
            <Button asChild>
              <Link href="/app/personas/nueva">
                Dar de alta a la primera persona
              </Link>
            </Button>
          ) : undefined
        }
        fields={fields}
        filter={filter}
        options={{
          region: toOptions(regions),
          area: toOptions(areaRows),
          puesto: toOptions(positionRows),
          sucursal: toOptions(siteRows),
          jefe: managers.map((manager) => ({
            value: manager.id,
            label: formatPersonName(manager),
          })),
        }}
        page={parsed.page}
        pageSize={parsed.pageSize}
        people={rows}
        today={today}
        total={total}
        views={views}
      />
    </div>
  );
};

export default PersonasPage;
