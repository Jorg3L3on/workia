"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { toneFor } from "@/lib/ui/status-tone";

export type CompanyListRow = {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  members: number;
  status: string;
};

const CompanyStatus = ({ row }: { row: CompanyListRow }) => (
  <Badge tone={toneFor("company", row.status)}>
    {row.status === "activa" ? "Activa" : "Suspendida"}
  </Badge>
);

const columns: DataTableColumn<CompanyListRow>[] = [
  {
    id: "name",
    header: "Empresa",
    accessor: (row) => row.name,
    cell: (row) => (
      <div className="min-w-0">
        <div className="text-foreground truncate">{row.name}</div>
        {row.legalName ? (
          <div className="text-muted-foreground truncate text-xs">
            {row.legalName}
          </div>
        ) : null}
      </div>
    ),
    cellClassName: "max-w-72",
  },
  {
    id: "slug",
    header: "Identificador",
    accessor: (row) => row.slug,
    variant: "muted",
    cellClassName: "font-mono text-xs",
  },
  {
    id: "members",
    header: "Miembros",
    accessor: (row) => row.members,
    variant: "numeric",
  },
  {
    id: "status",
    header: "Estado",
    accessor: (row) => row.status,
    cell: (row) => <CompanyStatus row={row} />,
  },
];

/** Platform console: the row opens the company. */
export const CompaniesDataTable = ({
  companies,
}: {
  companies: CompanyListRow[];
}) => (
  <DataTable
    columns={columns}
    data={companies}
    emptyTitle="Sin empresas todavía"
    getRowAriaLabel={(row) => `Abrir empresa ${row.name}`}
    getRowHref={(row) => `/admin/empresas/${row.id}`}
    getRowId={(row) => row.id}
    mobileCard={(row) => ({
      title: row.name,
      subtitle: `${row.slug} · ${row.members} ${row.members === 1 ? "miembro" : "miembros"}`,
      badge: <CompanyStatus row={row} />,
    })}
    rowTestId="company-row"
    searchPlaceholder="Buscar empresa"
  />
);
