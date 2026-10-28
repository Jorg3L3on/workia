"use client";

import { UserRoundIcon } from "lucide-react";
import { useMemo } from "react";

import { detailCardDomId } from "@/components/people/person-detail-model";
import { useServerListControls } from "@/components/list/use-server-list-controls";
import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  RowMenu,
  type DataTableColumn,
} from "@/components/ui/data-table";
import { DOCUMENT_STATUS_LABELS } from "@/lib/documents/person-card";
import {
  EXPIRING_DOCUMENTS_COPY,
  EXPIRING_STATUS_PARAMS,
  type ExpiringDocumentRow,
  type ExpiringDocumentStatus,
} from "@/lib/documents/expiring";
import { formatDateMx } from "@/lib/format/date";
import { toneFor } from "@/lib/ui/status-tone";

export type ExpiringDocumentsTrayProps = {
  items: ExpiringDocumentRow[];
  positions: { id: string; name: string }[];
  positionId: string;
  status: ExpiringDocumentStatus;
  error?: boolean;
};

const expedienteHref = (personId: string) =>
  `/app/personas/${personId}#${detailCardDomId("documentos")}`;

const StatusBadge = ({ status }: { status: ExpiringDocumentStatus }) => (
  <Badge tone={toneFor("document", status)}>
    {DOCUMENT_STATUS_LABELS[status]}
  </Badge>
);

const positionLabel = (row: ExpiringDocumentRow) =>
  row.positionName ?? EXPIRING_DOCUMENTS_COPY.noPosition;

export const ExpiringDocumentsTray = ({
  items,
  positions,
  positionId,
  status,
  error = false,
}: ExpiringDocumentsTrayProps) => {
  const controls = useServerListControls();
  const expired = status === "expired";

  const handlePositionChange = (next: string) => {
    controls.setFilter("puesto", next || null);
  };

  const handleStatusChange = (next: string) => {
    controls.setFilter(
      "estado",
      next === EXPIRING_STATUS_PARAMS.expired ? next : null,
    );
  };

  const handleClearFilters = () => {
    controls.setFilters({ puesto: null, estado: null });
  };

  const columns = useMemo<DataTableColumn<ExpiringDocumentRow>[]>(
    () => [
      {
        id: "person",
        header: "Persona",
        accessor: (row) => row.personName,
        variant: "primary",
        truncate: true,
      },
      {
        id: "position",
        header: "Puesto",
        accessor: (row) => positionLabel(row),
        variant: "muted",
        truncate: true,
      },
      {
        id: "document",
        header: "Documento",
        accessor: (row) => row.requirementName,
        variant: "muted",
        truncate: true,
      },
      {
        id: "expires",
        header: "Vence",
        accessor: (row) => row.expiresOn,
        variant: "muted",
        cell: (row) => formatDateMx(row.expiresOn),
      },
      {
        id: "status",
        header: "Estado",
        accessor: (row) => row.expiresOn,
        cell: (row) => <StatusBadge status={row.status} />,
      },
    ],
    [],
  );

  if (error) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {EXPIRING_DOCUMENTS_COPY.error}
      </p>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={items}
      emptyDescription={
        expired
          ? EXPIRING_DOCUMENTS_COPY.emptyExpiredDescription
          : EXPIRING_DOCUMENTS_COPY.emptyDescription
      }
      emptyTitle={
        expired
          ? EXPIRING_DOCUMENTS_COPY.emptyExpiredTitle
          : EXPIRING_DOCUMENTS_COPY.emptyTitle
      }
      filters={[
        {
          id: "puesto",
          label: "Puesto",
          value: positionId,
          onChange: handlePositionChange,
          options: positions.map((position) => ({
            value: position.id,
            label: position.name,
          })),
        },
        {
          id: "estado",
          label: "Estado",
          value: EXPIRING_STATUS_PARAMS[status],
          onChange: handleStatusChange,
          options: [
            {
              value: EXPIRING_STATUS_PARAMS.expiring,
              label: DOCUMENT_STATUS_LABELS.expiring,
            },
            {
              value: EXPIRING_STATUS_PARAMS.expired,
              label: DOCUMENT_STATUS_LABELS.expired,
            },
          ],
        },
      ]}
      getRowAriaLabel={(row) => `Ver expediente de ${row.personName}`}
      getRowHref={(row) => expedienteHref(row.personId)}
      getRowId={(row) => row.id}
      getSearchText={(row) =>
        `${positionLabel(row)} ${DOCUMENT_STATUS_LABELS[row.status]} ${formatDateMx(row.expiresOn)}`
      }
      mobileCard={(row) => ({
        title: row.personName,
        subtitle: `${row.requirementName} · vence ${formatDateMx(row.expiresOn)}`,
        badge: <StatusBadge status={row.status} />,
      })}
      noMatchesDescription="Prueba con otro nombre, puesto o documento."
      noMatchesTitle="Sin resultados"
      onClearFilters={handleClearFilters}
      rowMenu={(row) => (
        <RowMenu
          actions={[
            {
              label: "Ver expediente",
              icon: UserRoundIcon,
              href: expedienteHref(row.personId),
            },
          ]}
          label={`Acciones de ${row.personName}`}
        />
      )}
      rowTestId="expiring-document-row"
      searchPlaceholder={EXPIRING_DOCUMENTS_COPY.searchPlaceholder}
    />
  );
};
