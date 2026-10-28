"use client";

import { FileTextIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import {
  ActivityChipsField,
  type ActivityOption,
} from "@/components/catalog/activity-chips-field";
import {
  CatalogPage,
  CatalogStatusField,
  type CatalogRowBase,
  type CatalogSchema,
} from "@/components/catalog/catalog-page";
import {
  PositionDocumentsSection,
  type PositionDocumentRequirement,
} from "@/components/catalog/position-documents-section";
import { FormSheet } from "@/components/layout/form-sheet";
import { Tag } from "@/components/ui/badge";
import { EmptyValue } from "@/components/ui/data-table";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createActivityAction,
  createAreaAction,
  createPositionAction,
  deleteActivityAction,
  deleteAreaAction,
  deletePositionAction,
  updateActivityAction,
  updateAreaAction,
  updatePositionAction,
} from "@/lib/catalog/actions";
import {
  createRegionAction,
  deleteRegionAction,
  updateRegionAction,
} from "@/lib/regions/actions";
import {
  createSiteAction,
  deleteSiteAction,
  updateSiteAction,
} from "@/lib/sites/actions";
import { SITE_KINDS, siteKindLabels } from "@/lib/sites/schema";
import type { TerminationClassification } from "@/lib/db/schema/employment";
import {
  createTerminationReasonAction,
  deleteTerminationReasonAction,
  updateTerminationReasonAction,
} from "@/lib/termination-reasons/actions";
import {
  TERMINATION_CLASSIFICATIONS,
  terminationClassificationLabels,
} from "@/lib/termination-reasons/schema";

type Option = { id: string; name: string };

type EntityProps<TRow> = {
  rows: TRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  notice?: ReactNode;
};

const NameField = ({
  defaultValue,
  placeholder,
}: {
  defaultValue?: string;
  placeholder: string;
}) => (
  <div className="space-y-2">
    <Label htmlFor="catalog-name">Nombre</Label>
    <Input
      defaultValue={defaultValue}
      id="catalog-name"
      name="name"
      placeholder={placeholder}
      required
    />
  </div>
);

const Hidden = ({ name, value }: { name: string; value: string }) => (
  <input name={name} type="hidden" value={value} />
);

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const FEMININE_STATUS = {
  active: "Activa",
  inactive: "Inactiva",
  showActive: "Activas",
  showAll: "Todas",
};

const MASCULINE_STATUS = {
  active: "Activo",
  inactive: "Inactivo",
  showActive: "Activos",
  showAll: "Todos",
};

/** An option list that keeps the current value even when it is inactive. */
const withCurrent = (options: Option[], current: Option | null) =>
  current && !options.some((option) => option.id === current.id)
    ? [...options, { ...current, name: `${current.name} (inactiva)` }]
    : options;

// ── Áreas ──────────────────────────────────────────────────────────────

export type AreaCatalogRow = CatalogRowBase & {
  depth: number;
  parentAreaId: string | null;
  /** This area and every area under it: none can be its parent. */
  subtreeIds: string[];
  positionCount: number;
};

export const AreasCatalog = ({
  parents,
  ...props
}: EntityProps<AreaCatalogRow> & { parents: Option[] }) => {
  const schema: CatalogSchema<AreaCatalogRow> = {
    title: "Áreas",
    description:
      "El árbol de áreas de la empresa; un área inactiva no aparece en altas nuevas.",
    noun: "área",
    createLabel: "Nueva área",
    editTitle: "Editar área",
    searchPlaceholder: "Buscar área",
    emptyTitle: "Sin áreas registradas.",
    status: FEMININE_STATUS,
    depth: (row) => row.depth,
    columns: [
      {
        id: "positions",
        header: "Puestos",
        accessor: (row) => row.positionCount,
        variant: "numeric",
      },
    ],
    mobileSubtitle: (row) => plural(row.positionCount, "puesto", "puestos"),
    fields: (row) => {
      const current = row?.parentAreaId
        ? (props.rows.find((area) => area.id === row.parentAreaId) ?? null)
        : null;
      const options = withCurrent(
        parents.filter((area) => !row?.subtreeIds.includes(area.id)),
        current,
      );

      return (
        <>
          <NameField defaultValue={row?.name} placeholder="Ej. Operaciones" />
          <div className="space-y-2">
            <Label htmlFor="catalog-parent">Área padre (opcional)</Label>
            <FormSelect
              defaultValue={row?.parentAreaId ?? ""}
              id="catalog-parent"
              name="parentAreaId"
              options={[
                { value: "", label: "Sin área padre" },
                ...options.map((area) => ({
                  value: area.id,
                  label: area.name,
                })),
              ]}
              variant="field"
            />
          </div>
          <CatalogStatusField
            defaultActive={row?.active ?? true}
            label="Activa"
          />
        </>
      );
    },
    createAction: createAreaAction,
    updateAction: (id) => updateAreaAction.bind(null, id),
    keepFields: (row) => (
      <>
        <Hidden name="name" value={row.name} />
        <Hidden name="parentAreaId" value={row.parentAreaId ?? ""} />
      </>
    ),
    deleteAction: (id) => deleteAreaAction.bind(null, id),
  };

  return <CatalogPage schema={schema} {...props} />;
};

const VISIBLE_ACTIVITIES = 3;

// ── Puestos ────────────────────────────────────────────────────────────

export type { PositionDocumentRequirement };

export type PositionCatalogRow = CatalogRowBase & {
  areaId: string | null;
  areaName: string | null;
  activities: ActivityOption[];
  documents: PositionDocumentRequirement[];
};

export const PuestosCatalog = ({
  areas,
  activities,
  canManageDocuments,
  ...props
}: EntityProps<PositionCatalogRow> & {
  areas: Option[];
  activities: ActivityOption[];
  canManageDocuments: boolean;
}) => {
  const [documentsRow, setDocumentsRow] = useState<PositionCatalogRow | null>(
    null,
  );
  const [documentsPending, setDocumentsPending] = useState(false);
  const handleDocumentsPending = useCallback((pending: boolean) => {
    setDocumentsPending(pending);
  }, []);
  const openDocuments = documentsRow
    ? (props.rows.find((row) => row.id === documentsRow.id) ?? documentsRow)
    : null;
  const schema: CatalogSchema<PositionCatalogRow> = {
    title: "Puestos",
    description: "Puestos con su área y las actividades que realizan.",
    noun: "puesto",
    createLabel: "Nuevo puesto",
    editTitle: "Editar puesto",
    nameHeader: "Puesto",
    searchPlaceholder: "Buscar puesto, área, actividad o documento",
    emptyTitle: "Sin puestos registrados.",
    status: MASCULINE_STATUS,
    columns: [
      {
        id: "area",
        header: "Área",
        accessor: (row) => row.areaName ?? "",
        variant: "muted",
      },
      {
        id: "activities",
        header: "Actividades",
        accessor: (row) => row.activities.length,
        enableSorting: false,
        cell: (row) =>
          row.activities.length === 0 ? (
            <EmptyValue />
          ) : (
            <span
              className="flex flex-wrap gap-1"
              title={row.activities.map((activity) => activity.name).join(", ")}
            >
              {row.activities.slice(0, VISIBLE_ACTIVITIES).map((activity) => (
                <Tag key={activity.id}>{activity.name}</Tag>
              ))}
              {row.activities.length > VISIBLE_ACTIVITIES ? (
                <Tag>+{row.activities.length - VISIBLE_ACTIVITIES}</Tag>
              ) : null}
            </span>
          ),
      },
      {
        id: "documents",
        header: "Documentos",
        accessor: (row) => row.documents.length,
        variant: "numeric",
        cell: (row) =>
          row.documents.length === 0 ? <EmptyValue /> : row.documents.length,
      },
    ],
    getSearchText: (row) =>
      [
        ...row.activities.map((activity) => activity.name),
        ...row.documents.map((document) => document.name),
      ].join(" "),
    mobileSubtitle: (row) =>
      [
        row.areaName,
        plural(row.activities.length, "actividad", "actividades"),
        row.documents.length > 0
          ? plural(row.documents.length, "documento", "documentos")
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    rowActions: (row) => [
      {
        label: "Documentos requeridos",
        icon: FileTextIcon,
        onSelect: () => setDocumentsRow(row),
      },
    ],
    fields: (row) => {
      const current =
        row?.areaId && row.areaName
          ? { id: row.areaId, name: row.areaName }
          : null;

      return (
        <>
          <NameField defaultValue={row?.name} placeholder="Ej. Coordinador" />
          <div className="space-y-2">
            <Label htmlFor="catalog-area">Área (opcional)</Label>
            <FormSelect
              defaultValue={row?.areaId ?? ""}
              id="catalog-area"
              name="areaId"
              options={[
                { value: "", label: "Sin área" },
                ...withCurrent(areas, current).map((area) => ({
                  value: area.id,
                  label: area.name,
                })),
              ]}
              variant="field"
            />
          </div>
          <ActivityChipsField
            initial={row?.activities ?? []}
            options={activities}
          />
          <CatalogStatusField
            defaultActive={row?.active ?? true}
            label="Activo"
          />
        </>
      );
    },
    createAction: createPositionAction,
    updateAction: (id) => updatePositionAction.bind(null, id),
    keepFields: (row) => (
      <>
        <Hidden name="name" value={row.name} />
        <Hidden name="areaId" value={row.areaId ?? ""} />
      </>
    ),
    deleteAction: (id) => deletePositionAction.bind(null, id),
    deleteImpact: (row) =>
      row.activities.length > 0
        ? `sus ${plural(row.activities.length, "actividad asignada", "actividades asignadas")}`
        : null,
  };

  return (
    <>
      <CatalogPage schema={schema} {...props} />
      <FormSheet
        description={openDocuments?.name}
        formId="position-documents-form"
        hideFooter={!canManageDocuments}
        onOpenChange={(open) => {
          if (!open && !documentsPending) setDocumentsRow(null);
        }}
        open={openDocuments !== null}
        pending={documentsPending}
        submitLabel="Guardar documentos"
        title="Documentos requeridos"
      >
        {openDocuments ? (
          <PositionDocumentsSection
            canManage={canManageDocuments}
            formId="position-documents-form"
            key={openDocuments.id}
            onPendingChange={handleDocumentsPending}
            positionId={openDocuments.id}
            requirements={openDocuments.documents}
            showSubmit={false}
          />
        ) : null}
      </FormSheet>
    </>
  );
};

// ── Actividades ────────────────────────────────────────────────────────

export type ActivityCatalogRow = CatalogRowBase & { positionCount: number };

export const ActividadesCatalog = (props: EntityProps<ActivityCatalogRow>) => {
  const schema: CatalogSchema<ActivityCatalogRow> = {
    title: "Actividades",
    description: "Actividades que se asignan a los puestos.",
    noun: "actividad",
    createLabel: "Nueva actividad",
    editTitle: "Editar actividad",
    nameHeader: "Actividad",
    searchPlaceholder: "Buscar actividad",
    emptyTitle: "Sin actividades registradas.",
    status: FEMININE_STATUS,
    columns: [
      {
        id: "positions",
        header: "Puestos",
        accessor: (row) => row.positionCount,
        variant: "numeric",
      },
    ],
    mobileSubtitle: (row) => plural(row.positionCount, "puesto", "puestos"),
    fields: (row) => (
      <>
        <NameField
          defaultValue={row?.name}
          placeholder="Ej. Atención a solicitudes internas"
        />
        <CatalogStatusField
          defaultActive={row?.active ?? true}
          label="Activa"
        />
      </>
    ),
    createAction: createActivityAction,
    updateAction: (id) => updateActivityAction.bind(null, id),
    keepFields: (row) => <Hidden name="name" value={row.name} />,
    deleteAction: (id) => deleteActivityAction.bind(null, id),
  };

  return <CatalogPage schema={schema} {...props} />;
};

// ── Sucursales ─────────────────────────────────────────────────────────

export type SiteCatalogRow = CatalogRowBase & {
  kind: (typeof SITE_KINDS)[number];
  regionId: string | null;
  regionName: string | null;
};

export const SucursalesCatalog = ({
  regions,
  ...props
}: EntityProps<SiteCatalogRow> & { regions: Option[] }) => {
  const schema: CatalogSchema<SiteCatalogRow> = {
    title: "Sucursales",
    description: "Dónde trabaja la gente: corporativo o sucursal.",
    noun: "sucursal",
    createLabel: "Nueva sucursal",
    editTitle: "Editar sucursal",
    searchPlaceholder: "Buscar sucursal o región",
    emptyTitle: "Sin sucursales registradas.",
    // Sucursales have no active flag in the model: no status, no Desactivar.
    status: null,
    columns: [
      {
        id: "kind",
        header: "Tipo",
        accessor: (row) => siteKindLabels[row.kind],
        variant: "muted",
      },
      {
        id: "region",
        header: "Región",
        accessor: (row) => row.regionName ?? "",
        variant: "muted",
      },
    ],
    mobileSubtitle: (row) =>
      [siteKindLabels[row.kind], row.regionName].filter(Boolean).join(" · "),
    fields: (row) => {
      const current =
        row?.regionId && row.regionName
          ? { id: row.regionId, name: row.regionName }
          : null;

      return (
        <>
          <NameField
            defaultValue={row?.name}
            placeholder="Ej. Sucursal Demo Norte"
          />
          <div className="space-y-2">
            <Label htmlFor="catalog-kind">Tipo</Label>
            <FormSelect
              defaultValue={row?.kind ?? "sucursal"}
              id="catalog-kind"
              name="kind"
              options={SITE_KINDS.map((kind) => ({
                value: kind,
                label: siteKindLabels[kind],
              }))}
              required
              variant="field"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="catalog-region">Región (opcional)</Label>
            <FormSelect
              defaultValue={row?.regionId ?? ""}
              id="catalog-region"
              name="regionId"
              options={[
                { value: "", label: "Sin región" },
                ...withCurrent(regions, current).map((region) => ({
                  value: region.id,
                  label: region.name,
                })),
              ]}
              variant="field"
            />
          </div>
        </>
      );
    },
    createAction: createSiteAction,
    updateAction: (id) => updateSiteAction.bind(null, id),
    deleteAction: (id) => deleteSiteAction.bind(null, id),
  };

  return <CatalogPage schema={schema} {...props} />;
};

// ── Regiones ───────────────────────────────────────────────────────────

export type RegionCatalogRow = CatalogRowBase & { siteNames: string[] };

export const RegionesCatalog = (props: EntityProps<RegionCatalogRow>) => {
  const schema: CatalogSchema<RegionCatalogRow> = {
    title: "Regiones",
    description: "Agrupan sucursales, p. ej. Norte o Bajío.",
    noun: "región",
    createLabel: "Nueva región",
    editTitle: "Editar región",
    searchPlaceholder: "Buscar región o sucursal",
    emptyTitle: "Sin regiones registradas.",
    status: FEMININE_STATUS,
    columns: [
      {
        id: "sites",
        header: "Sucursales",
        accessor: (row) => row.siteNames.join(", "),
        variant: "muted",
        truncate: true,
      },
    ],
    mobileSubtitle: (row) =>
      plural(row.siteNames.length, "sucursal", "sucursales"),
    fields: (row) => (
      <>
        <NameField defaultValue={row?.name} placeholder="Ej. Región Norte" />
        <CatalogStatusField
          defaultActive={row?.active ?? true}
          label="Activa"
        />
      </>
    ),
    createAction: createRegionAction,
    updateAction: (id) => updateRegionAction.bind(null, id),
    keepFields: (row) => <Hidden name="name" value={row.name} />,
    deleteAction: (id) => deleteRegionAction.bind(null, id),
  };

  return <CatalogPage schema={schema} {...props} />;
};

// ── Motivos de baja ────────────────────────────────────────────────────

export type MotivoBajaCatalogRow = CatalogRowBase & {
  useCount: number;
  /** Null: created before migration 0027 and not classified yet. */
  classification: TerminationClassification | null;
};

const classificationLabel = (
  classification: TerminationClassification | null,
) =>
  classification
    ? terminationClassificationLabels[classification]
    : "Sin clasificar";

/**
 * Motivos de baja (Iniciativa 2): the company's own list over a seeded base.
 * One already used in a baja can be renamed or deactivated, not deleted.
 * Its classification (WRK-I12) splits the turnover report by who decided.
 */
export const MotivosBajaCatalog = (
  props: EntityProps<MotivoBajaCatalogRow>,
) => {
  const schema: CatalogSchema<MotivoBajaCatalogRow> = {
    title: "Motivos de baja",
    description:
      "Los motivos que se eligen al dar de baja a una persona; uno inactivo no aparece en bajas nuevas.",
    noun: "motivo",
    createLabel: "Nuevo motivo",
    editTitle: "Editar motivo",
    searchPlaceholder: "Buscar motivo",
    emptyTitle: "Sin motivos de baja registrados.",
    status: MASCULINE_STATUS,
    columns: [
      {
        id: "classification",
        header: "Clasificación",
        accessor: (row) => classificationLabel(row.classification),
        cell: (row) =>
          row.classification ? (
            classificationLabel(row.classification)
          ) : (
            <Tag>Sin clasificar</Tag>
          ),
      },
      {
        id: "uses",
        header: "Bajas",
        accessor: (row) => row.useCount,
        variant: "muted",
        cell: (row) =>
          row.useCount > 0 ? (
            plural(row.useCount, "baja", "bajas")
          ) : (
            <EmptyValue />
          ),
      },
    ],
    mobileSubtitle: (row) =>
      `${classificationLabel(row.classification)} · ${plural(row.useCount, "baja", "bajas")}`,
    fields: (row) => (
      <>
        <NameField
          defaultValue={row?.name}
          placeholder="Ej. Renuncia voluntaria"
        />
        <div className="space-y-2">
          <Label htmlFor="catalog-classification">Clasificación</Label>
          <FormSelect
            defaultValue={row?.classification ?? ""}
            id="catalog-classification"
            name="classification"
            options={TERMINATION_CLASSIFICATIONS.map((classification) => ({
              value: classification,
              label: terminationClassificationLabels[classification],
            }))}
            placeholder="Elige quién decidió la baja"
            required
            variant="field"
          />
          <p className="text-muted-foreground text-xs">
            Voluntaria: decide la persona. Involuntaria: decide la empresa.
            Otra: jubilación, fallecimiento.
          </p>
        </div>
        <CatalogStatusField
          defaultActive={row?.active ?? true}
          label="Activo"
        />
      </>
    ),
    createAction: createTerminationReasonAction,
    updateAction: (id) => updateTerminationReasonAction.bind(null, id),
    keepFields: (row) => (
      <>
        <Hidden name="name" value={row.name} />
        <Hidden name="classification" value={row.classification ?? ""} />
      </>
    ),
    deleteAction: (id) => deleteTerminationReasonAction.bind(null, id),
  };

  return <CatalogPage schema={schema} {...props} />;
};
