import type { Metadata } from "next";
import Link from "next/link";
import {
  DownloadIcon,
  FileDownIcon,
  HistoryIcon,
  PlusIcon,
  SheetIcon,
  UploadIcon,
} from "lucide-react";

import { pageTitles } from "@/lib/brand/chrome-copy";

import { PageHeader } from "@/components/layout/page-header";
import { PersonasDataTable } from "@/components/people/personas-data-table";
import { Button } from "@/components/ui/button";
import { parseListPaging } from "@/lib/list/paging";
import { listPeoplePage } from "@/lib/people";
import { listRegions } from "@/lib/regions";
import { assertPeopleListAccess } from "@/lib/people/actions";
import { formatPersonName } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.personas,
};

type PersonasPageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    deleted?: string;
    page?: string;
    pageSize?: string;
    region?: string;
  }>;
};

const PersonasPage = async ({ searchParams }: PersonasPageProps) => {
  const session = await assertPeopleListAccess();
  const params = await searchParams;
  const { q, deleted } = params;
  const status =
    params.status === "activa" || params.status === "baja"
      ? params.status
      : undefined;
  const { page, pageSize } = parseListPaging(params);

  const regions = await listRegions(session.companyId);
  // Only a region of this company filters; anything else is ignored.
  const regionId = regions.some((region) => region.id === params.region)
    ? params.region
    : undefined;
  const [
    { rows: people, total },
    canCreate,
    canImport,
    canExport,
    canUpdate,
    canReadContracts,
  ] = await Promise.all([
    listPeoplePage(session.companyId, {
      query: q,
      status,
      deleted: deleted === "1",
      regionId,
      page,
      pageSize,
    }),
    userHasPermission(session.user.id, "people:create"),
    userHasPermission(session.user.id, "people:import"),
    userHasPermission(session.user.id, "people:export"),
    userHasPermission(session.user.id, "people:update"),
    userHasPermission(session.user.id, "contracts:read"),
  ]);
  const exportQuery = new URLSearchParams();

  if (q) exportQuery.set("q", q);
  if (status) exportQuery.set("status", status);
  if (deleted === "1") exportQuery.set("deleted", "1");

  const rows = people.map((person) => ({
    id: person.id,
    name: formatPersonName(person),
    rfc: person.rfc,
    fechaIngreso: person.fechaIngreso,
    status: person.status,
    deleted: Boolean(person.deletedAt),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Expedientes, relación laboral e identificadores."
        menu={[
          canExport && {
            label: "Exportar a Excel",
            icon: SheetIcon,
            href: `/app/personas/exportar?${exportQuery}`,
            download: true,
          },
          canExport && {
            label: "Exportar a CSV",
            icon: DownloadIcon,
            href: `/app/personas/exportar?${new URLSearchParams({ ...Object.fromEntries(exportQuery), format: "csv" })}`,
            download: true,
          },
          canImport && {
            label: "Descargar plantilla",
            icon: FileDownIcon,
            href: "/app/personas/plantilla",
            download: true,
          },
          canImport && {
            label: "Historial de importaciones",
            icon: HistoryIcon,
            href: "/app/personas/importaciones",
          },
        ]}
        primary={
          canCreate
            ? {
                label: "Nueva persona",
                icon: PlusIcon,
                href: "/app/personas/nueva",
              }
            : null
        }
        secondary={
          canImport
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
        canReadContracts={canReadContracts}
        canUpdate={canUpdate}
        emptyAction={
          canCreate ? (
            <Button asChild>
              <Link href="/app/personas/nueva">
                Dar de alta a la primera persona
              </Link>
            </Button>
          ) : undefined
        }
        page={page}
        pageSize={pageSize}
        people={rows}
        query={q?.trim() ?? ""}
        region={regionId ?? ""}
        regions={regions.map((region) => ({
          id: region.id,
          name: region.name,
        }))}
        status={status ?? ""}
        total={total}
        visibility={deleted === "1" ? "deleted" : "expediente"}
      />
    </div>
  );
};

export default PersonasPage;
