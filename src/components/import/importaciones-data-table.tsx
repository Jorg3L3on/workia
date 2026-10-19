"use client";

import { DownloadIcon, PlayIcon, Undo2Icon } from "lucide-react";
import { useMemo, useState } from "react";

import { ImportUndoDialog } from "@/components/import/import-undo-dialog";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  RowMenu,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { toneFor } from "@/lib/ui/status-tone";

export type ImportJobRow = {
  id: string;
  fileName: string;
  createdAt: Date;
  actor: string | null;
  status: string;
  statusLabel: string;
  total: number;
  created: number;
  updated: number;
  errors: number;
  resumable: boolean;
  /** Errors file is ready to download. */
  hasErrorsFile: boolean;
  undoable: boolean;
};

const formatCount = (value: number) => value.toLocaleString("es-MX");

const ImportStatus = ({ row }: { row: ImportJobRow }) => (
  <Badge tone={toneFor("importJob", row.status)}>{row.statusLabel}</Badge>
);

/** Import history (WRK-I3): a resumable import opens where it paused. */
export const ImportacionesDataTable = ({ jobs }: { jobs: ImportJobRow[] }) => {
  const [undoing, setUndoing] = useState<ImportJobRow | null>(null);

  const columns = useMemo<DataTableColumn<ImportJobRow>[]>(
    () => [
      {
        id: "file",
        header: "Archivo",
        accessor: (row) => row.fileName,
        variant: "primary",
        truncate: true,
      },
      {
        id: "date",
        header: "Fecha",
        accessor: (row) => row.createdAt,
        variant: "muted",
      },
      {
        id: "actor",
        header: "Hecha por",
        accessor: (row) => row.actor ?? "",
        truncate: true,
      },
      {
        id: "status",
        header: "Estado",
        accessor: (row) => row.statusLabel,
        cell: (row) => <ImportStatus row={row} />,
      },
      {
        id: "rows",
        header: "Filas",
        accessor: (row) => row.total,
        variant: "numeric",
        cell: (row) => (
          <span
            title={`${formatCount(row.created)} nuevas · ${formatCount(row.updated)} actualizadas · ${formatCount(row.errors)} con errores`}
          >
            {formatCount(row.total)}
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={jobs}
        emptyTitle="Todavía no hay importaciones"
        getRowAriaLabel={(row) => `Continuar importación ${row.fileName}`}
        getRowHref={(row) =>
          row.resumable ? `/app/personas/importar?job=${row.id}` : undefined
        }
        getRowId={(row) => row.id}
        mobileCard={(row) => ({
          title: row.fileName,
          subtitle: `${formatCount(row.total)} filas · ${formatCount(row.errors)} con errores`,
          badge: <ImportStatus row={row} />,
        })}
        rowMenu={(row) => (
          <RowMenu
            actions={[
              row.resumable && {
                label: "Continuar",
                icon: PlayIcon,
                href: `/app/personas/importar?job=${row.id}`,
              },
              row.hasErrorsFile && {
                label: "Descargar errores",
                icon: DownloadIcon,
                href: `/api/import/personas/${row.id}/errors`,
                download: true,
              },
              row.undoable && {
                label: "Deshacer importación",
                icon: Undo2Icon,
                destructive: true,
                onSelect: () => setUndoing(row),
              },
            ]}
            label={`Acciones de ${row.fileName}`}
          />
        )}
        rowTestId="import-row"
        searchPlaceholder="Buscar archivo o persona"
      />
      {undoing ? (
        <ImportUndoDialog
          fileName={undoing.fileName}
          jobId={undoing.id}
          key={undoing.id}
          onOpenChange={(open) => {
            if (!open) setUndoing(null);
          }}
          open
        />
      ) : null}
    </>
  );
};
