"use client";

import {
  PencilIcon,
  PlusIcon,
  PowerIcon,
  PowerOffIcon,
  Trash2Icon,
} from "lucide-react";
import {
  useMemo,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";

import { FormSheet } from "@/components/layout/form-sheet";
import { PageHeader } from "@/components/layout/page-header";
import { CompanyField } from "@/components/tenant/company-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  RowMenu,
  type DataTableColumn,
  type RowMenuAction,
} from "@/components/ui/data-table";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { activeTone } from "@/lib/ui/status-tone";
import { cn } from "@/lib/utils";

/** What points at a record; «Eliminar» shows only when every count is 0. */
export type CatalogReference = { count: number; one: string; many: string };

export type CatalogRowBase = {
  id: string;
  name: string;
  active: boolean;
  references: CatalogReference[];
};

type ServerAction = (formData: FormData) => void | Promise<void>;

/** One catálogo entity: its words, its columns and its sheet (WRK-I6-5). */
export type CatalogSchema<TRow extends CatalogRowBase> = {
  title: string;
  description: string;
  /** «área»; the sheet titles and the delete confirmation use it. */
  noun: string;
  /** «Nueva área». */
  createLabel: string;
  editTitle: string;
  searchPlaceholder: string;
  emptyTitle: string;
  /** Labels of the status badge and the Activos / Todos toggle; null: no status (Sucursales). */
  status: {
    active: string;
    inactive: string;
    showActive: string;
    showAll: string;
  } | null;
  /** Relation columns, between the name and the status. */
  columns: DataTableColumn<TRow>[];
  nameHeader?: string;
  mobileSubtitle?: (row: TRow) => ReactNode;
  getSearchText?: (row: TRow) => string;
  /** Áreas: the tree's level, shown as indentation (and the order is the tree's). */
  depth?: (row: TRow) => number;
  /** The sheet's fields for a new record (null) or an existing one. */
  fields: (row: TRow | null) => ReactNode;
  createAction: ServerAction;
  updateAction: (id: string) => ServerAction;
  /** Hidden fields that resend a row as it is, so «Desactivar» only flips `active`. */
  keepFields?: (row: TRow) => ReactNode;
  deleteAction: (id: string) => () => void | Promise<void>;
  /** What else goes with the record (e.g. its activities), named in the confirmation. */
  deleteImpact?: (row: TRow) => string | null;
  /** Extra ⋯ actions, after Editar. The menu shows even without update or delete. */
  rowActions?: (row: TRow) => (RowMenuAction | false | null | undefined)[];
};

type CatalogPageProps<TRow extends CatalogRowBase> = {
  schema: CatalogSchema<TRow>;
  rows: TRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** Saved / error messages under the header. */
  notice?: ReactNode;
};

const hasReferences = (row: CatalogRowBase) =>
  row.references.some((reference) => reference.count > 0);

/** «3 personas y 1 puesto». */
export const describeReferences = (references: CatalogReference[]) => {
  const parts = references
    .filter((reference) => reference.count > 0)
    .map(
      (reference) =>
        `${reference.count} ${reference.count === 1 ? reference.one : reference.many}`,
    );

  return parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`
    : (parts[0] ?? "");
};

/** The status switch of a sheet; always sends `active` (true or false). */
export const CatalogStatusField = ({
  defaultActive,
  label,
}: {
  defaultActive: boolean;
  label: string;
}) => {
  const [active, setActive] = useState(defaultActive);

  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor="catalog-active">{label}</Label>
      <input name="active" type="hidden" value={active ? "true" : "false"} />
      <Switch
        checked={active}
        id="catalog-active"
        onCheckedChange={setActive}
      />
    </div>
  );
};

const StatusToggle = ({
  showAll,
  onChange,
  labels,
}: {
  showAll: boolean;
  onChange: (showAll: boolean) => void;
  labels: { showActive: string; showAll: string };
}) => (
  <div
    aria-label="Estado"
    className="bg-card inline-flex h-9 shrink-0 items-center rounded-lg border p-0.5"
    role="group"
  >
    {[
      { all: false, label: labels.showActive },
      { all: true, label: labels.showAll },
    ].map((option) => (
      <button
        aria-pressed={showAll === option.all}
        className={cn(
          "focus-visible:ring-ring/50 h-full rounded-md px-3 text-sm outline-none focus-visible:ring-3",
          showAll === option.all
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
        key={option.label}
        onClick={() => onChange(option.all)}
        type="button"
      >
        {option.label}
      </button>
    ))}
  </div>
);

/**
 * The catálogo template: header with «Nueva …», search and Activos / Todos,
 * one table with a ⋯ menu per row (Editar, Desactivar / Activar, Eliminar
 * when nothing points at the record) and create / edit in a side sheet.
 */
export const CatalogPage = <TRow extends CatalogRowBase>({
  schema,
  rows,
  canCreate,
  canUpdate,
  canDelete,
  notice,
}: CatalogPageProps<TRow>) => {
  // undefined: closed; null: creating; a row: editing it.
  const [editing, setEditing] = useState<TRow | null | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);
  const [pending, startTransition] = useTransition();
  const { status, depth } = schema;

  const columns = useMemo<DataTableColumn<TRow>[]>(() => {
    const all: DataTableColumn<TRow>[] = [
      {
        id: "name",
        header: schema.nameHeader ?? "Nombre",
        accessor: (row) => row.name,
        variant: "primary",
        truncate: !depth,
        cell: depth
          ? (row) => (
              <span
                className="block truncate"
                style={{ paddingLeft: `${depth(row) * 1.25}rem` }}
                title={row.name}
              >
                {row.name}
              </span>
            )
          : undefined,
      },
      ...schema.columns,
      ...(status
        ? [
            {
              id: "status",
              header: "Estado",
              accessor: (row: TRow) =>
                row.active ? status.active : status.inactive,
              cell: (row: TRow) => (
                <Badge tone={activeTone(row.active)}>
                  {row.active ? status.active : status.inactive}
                </Badge>
              ),
            },
          ]
        : []),
    ];

    // Áreas keep the tree's order: no column sorts.
    return depth
      ? all.map((column) => ({ ...column, enableSorting: false }))
      : all;
  }, [schema.nameHeader, schema.columns, status, depth]);

  const close = () => setEditing(undefined);
  const isOpen = editing !== undefined;
  const formId = "catalog-sheet-form";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const action = editing
      ? schema.updateAction(editing.id)
      : schema.createAction;

    startTransition(async () => {
      await action(formData);
      close();
    });
  };

  const deleteDescription = (row: TRow) => {
    const extra = schema.deleteImpact?.(row);

    return `«${row.name}» sale del catálogo${extra ? ` junto con ${extra}` : ""}. Ningún registro lo usa; el historial de auditoría se conserva.`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={schema.description}
        primary={
          canCreate ? (
            <Button onClick={() => setEditing(null)} type="button">
              <PlusIcon aria-hidden />
              {schema.createLabel}
            </Button>
          ) : null
        }
        title={schema.title}
      />

      {notice}

      <DataTable
        columns={columns}
        data={rows}
        emptyTitle={schema.emptyTitle}
        filterRow={status && !showAll ? (row) => row.active : undefined}
        getRowAriaLabel={(row) => `Editar ${row.name}`}
        getRowId={(row) => row.id}
        getSearchText={schema.getSearchText}
        mobileCard={(row) => ({
          title: row.name,
          subtitle: schema.mobileSubtitle?.(row),
          badge: status ? (
            <Badge tone={activeTone(row.active)}>
              {row.active ? status.active : status.inactive}
            </Badge>
          ) : undefined,
        })}
        onRowOpen={canUpdate ? (row) => setEditing(row) : undefined}
        rowMenu={
          canUpdate || canDelete || schema.rowActions
            ? (row) => (
                <RowMenu
                  actions={[
                    canUpdate && {
                      label: "Editar",
                      icon: PencilIcon,
                      onSelect: () => setEditing(row),
                    },
                    ...(schema.rowActions?.(row) ?? []),
                    canUpdate &&
                      status &&
                      schema.keepFields && {
                        label: row.active ? "Desactivar" : "Activar",
                        icon: row.active ? PowerOffIcon : PowerIcon,
                        action: schema.updateAction(row.id),
                        fields: (
                          <>
                            <CompanyField />
                            {schema.keepFields(row)}
                            <input
                              name="active"
                              type="hidden"
                              value={row.active ? "false" : "true"}
                            />
                          </>
                        ),
                      },
                    canDelete &&
                      !hasReferences(row) && {
                        label: "Eliminar",
                        icon: Trash2Icon,
                        destructive: true,
                        action: schema.deleteAction(row.id),
                        confirm: {
                          title: `¿Eliminar ${schema.noun}?`,
                          description: deleteDescription(row),
                          confirmLabel: "Eliminar",
                        },
                      },
                  ]}
                  label={`Acciones de ${row.name}`}
                />
              )
            : undefined
        }
        searchPlaceholder={schema.searchPlaceholder}
        toolbar={
          status ? (
            <StatusToggle
              labels={status}
              onChange={setShowAll}
              showAll={showAll}
            />
          ) : undefined
        }
      />

      <FormSheet
        description={
          editing && hasReferences(editing)
            ? `Lo usan ${describeReferences(editing.references)}.`
            : undefined
        }
        formId={formId}
        onOpenChange={(open) => {
          if (!open && !pending) close();
        }}
        open={isOpen}
        pending={pending}
        submitLabel={editing ? "Guardar cambios" : `Crear ${schema.noun}`}
        title={editing ? schema.editTitle : schema.createLabel}
      >
        {isOpen ? (
          <form
            className="space-y-4"
            id={formId}
            key={editing?.id ?? "new"}
            onSubmit={handleSubmit}
          >
            <CompanyField />
            {schema.fields(editing ?? null)}
          </form>
        ) : null}
      </FormSheet>
    </div>
  );
};
