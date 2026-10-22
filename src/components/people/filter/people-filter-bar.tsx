"use client";

import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";

import {
  ChipClear,
  chipClassName,
  FilterBar,
} from "@/components/layout/filter-bar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { countPeopleFilterOptionsAction } from "@/lib/people/filter/actions";
import {
  conditionAriaLabel,
  describeCondition,
  type PeopleFilterOption,
  type PeopleFilterOptions,
} from "@/lib/people/filter/describe";
import type {
  PeopleFilterFieldDefinition,
  PeopleFilterFieldId,
} from "@/lib/people/filter/fields";
import {
  conditionFor,
  isEmptyPeopleFilter,
  withCondition,
  type PeopleFilter,
  type PeopleFilterCondition,
} from "@/lib/people/filter/schema";
import { cn } from "@/lib/utils";

import { PeopleFilterFieldEditor } from "./people-filter-field-editor";
import { PeopleFilterSheet } from "./people-filter-sheet";

/** Always shown, even without a value, as the list had before. */
const PINNED_FIELDS: readonly PeopleFilterFieldId[] = ["relacion"];

const CHIP_MOTION =
  "animate-in fade-in-0 zoom-in-95 duration-(--duration-md) ease-(--ease-out-product) motion-reduce:animate-none";

export type PeopleFilterBarProps = {
  filter: PeopleFilter;
  /** The fields this user may filter by (contract ones need contracts:read). */
  fields: PeopleFilterFieldDefinition[];
  options: PeopleFilterOptions;
  /** People matching the applied filter. */
  total: number;
  today: string;
  onApply: (filter: PeopleFilter) => boolean;
  /** Right side of the bar: columns and «Exportar (N)». */
  children?: ReactNode;
};

/** Counts of one field's options, fetched when its editor opens. */
const useOptionCounts = (filter: PeopleFilter) => {
  const [counts, setCounts] = useState<
    Partial<Record<PeopleFilterFieldId, Record<string, number> | null>>
  >({});

  const load = useCallback(
    (field: PeopleFilterFieldDefinition) => {
      if (!field.counts) return;
      setCounts((current) => ({ ...current, [field.id]: null }));
      void countPeopleFilterOptionsAction(filter, field.id).then((result) =>
        setCounts((current) => ({ ...current, [field.id]: result })),
      );
    },
    [filter],
  );

  return { counts, load };
};

const ConditionChip = ({
  field,
  condition,
  options,
  counts,
  open,
  onOpenChange,
  onChange,
  onPersonLabel,
  today,
}: {
  field: PeopleFilterFieldDefinition;
  condition: PeopleFilterCondition | undefined;
  options: PeopleFilterOptions;
  counts: Record<string, number> | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (condition: PeopleFilterCondition | null) => void;
  onPersonLabel: (option: PeopleFilterOption) => void;
  today: string;
}) => {
  const active = Boolean(condition);
  const parts = condition ? describeCondition(condition, options) : null;

  return (
    <div
      className={cn(chipClassName(active), CHIP_MOTION)}
      data-testid={`filter-${field.id}`}
    >
      <Popover onOpenChange={onOpenChange} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-label={
              condition ? conditionAriaLabel(condition, options) : field.label
            }
            className="inline-flex min-w-0 items-center gap-1.5 outline-none"
            type="button"
          >
            <span className={cn(active && "text-primary/80")}>
              {field.label}
            </span>
            {parts ? (
              <>
                <span className="text-primary/70">· {parts.operator}</span>
                {parts.value ? (
                  <span className="max-w-48 truncate font-medium">
                    · {parts.value}
                  </span>
                ) : null}
              </>
            ) : (
              <ChevronDownIcon
                aria-hidden
                className="text-muted-foreground size-4"
              />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="grid w-80 gap-3 p-3">
          <p className="text-sm font-medium">{field.label}</p>
          <PeopleFilterFieldEditor
            condition={condition}
            counts={counts}
            field={field}
            onChange={onChange}
            onPersonLabel={onPersonLabel}
            options={options}
            today={today}
          />
        </PopoverContent>
      </Popover>
      {active ? (
        <ChipClear label={field.label} onClear={() => onChange(null)} />
      ) : null}
    </div>
  );
};

/** «Expediente: Borrados» — not a condition: which expedientes are listed. */
const DeletedChip = ({
  deleted,
  onChange,
}: {
  deleted: boolean;
  onChange: (deleted: boolean) => void;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(chipClassName(deleted), CHIP_MOTION)}
      data-testid="filter-deleted"
    >
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-label={deleted ? "Expediente: Borrados" : "Expediente"}
            className="inline-flex items-center gap-1.5 outline-none"
            type="button"
          >
            <span className={cn(deleted && "text-primary/80")}>
              Expediente{deleted ? ":" : null}
            </span>
            {deleted ? (
              <span className="font-medium">Borrados</span>
            ) : (
              <ChevronDownIcon
                aria-hidden
                className="text-muted-foreground size-4"
              />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0">
          <Command label="Expediente">
            <CommandList>
              <CommandGroup>
                {[
                  { value: false, label: "Vigentes" },
                  { value: true, label: "Borrados" },
                ].map((option) => (
                  <CommandItem
                    data-checked={option.value === deleted}
                    key={option.label}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    value={option.label}
                  >
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {deleted ? (
        <ChipClear label="Expediente" onClear={() => onChange(false)} />
      ) : null}
    </div>
  );
};

/** «+ Filtro»: the fields that have no chip yet. */
const AddFilter = ({
  fields,
  onPick,
}: {
  fields: PeopleFilterFieldDefinition[];
  onPick: (field: PeopleFilterFieldDefinition) => void;
}) => {
  const [open, setOpen] = useState(false);

  if (fields.length === 0) return null;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button className="h-9 border-dashed" type="button" variant="secondary">
          <PlusIcon aria-hidden />
          Filtro
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        <Command label="Agregar filtro">
          <CommandList>
            <CommandGroup>
              {fields.map((field) => (
                <CommandItem
                  key={field.id}
                  onSelect={() => {
                    setOpen(false);
                    onPick(field);
                  }}
                  value={field.label}
                >
                  {field.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/**
 * The Personas filter: search, one chip per condition («campo · operador ·
 * valor ×»), «+ Filtro» and «Limpiar». Every change goes to the URL at once.
 * Below 768px the chips move into a sheet with «Ver N personas».
 */
export const PeopleFilterBar = ({
  filter,
  fields,
  options,
  total,
  today,
  onApply,
  children,
}: PeopleFilterBarProps) => {
  const [openField, setOpenField] = useState<PeopleFilterFieldId | null>(null);
  const [personLabels, setPersonLabels] = useState<PeopleFilterOption[]>([]);
  const { counts, load } = useOptionCounts(filter);
  const allOptions: PeopleFilterOptions = {
    ...options,
    jefe: [...(options.jefe ?? []), ...personLabels],
  };
  const rememberPerson = (option: PeopleFilterOption) =>
    setPersonLabels((current) => [...current, option]);

  const shownFields = fields.filter(
    (field) =>
      PINNED_FIELDS.includes(field.id) ||
      conditionFor(filter, field.id) ||
      openField === field.id,
  );
  const addable = fields.filter((field) => !shownFields.includes(field));
  const activeCount = filter.conditions.length + (filter.deleted ? 1 : 0);

  const change = (
    field: PeopleFilterFieldId,
    condition: PeopleFilterCondition | null,
  ) => onApply(withCondition(filter, field, condition));

  return (
    <FilterBar
      search={{
        value: filter.q,
        onChange: (q) => onApply({ ...filter, q }),
        placeholder: "Buscar por nombre, RFC o CURP...",
      }}
    >
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {shownFields.map((field) => (
          <ConditionChip
            condition={conditionFor(filter, field.id)}
            counts={counts[field.id]}
            field={field}
            key={field.id}
            onChange={(condition) => change(field.id, condition)}
            onOpenChange={(open) => {
              setOpenField(open ? field.id : null);
              if (open) load(field);
            }}
            onPersonLabel={rememberPerson}
            open={openField === field.id}
            options={allOptions}
            today={today}
          />
        ))}
        <DeletedChip
          deleted={filter.deleted}
          onChange={(deleted) => onApply({ ...filter, deleted })}
        />
        <AddFilter
          fields={addable}
          onPick={(field) => {
            setOpenField(field.id);
            load(field);
          }}
        />
        {!isEmptyPeopleFilter(filter) ? (
          <Button
            className="text-muted-foreground h-9 px-2"
            onClick={() => onApply({ q: "", deleted: false, conditions: [] })}
            type="button"
            variant="link"
          >
            Limpiar
          </Button>
        ) : null}
      </div>

      {/* Phones: search on its own row, then the sheet and the actions. */}
      <div className="flex w-full items-center gap-2 md:ml-auto md:w-auto">
        <PeopleFilterSheet
          activeCount={activeCount}
          fields={fields}
          filter={filter}
          onApply={onApply}
          onPersonLabel={rememberPerson}
          options={allOptions}
          today={today}
          total={total}
        />
        <span
          aria-live="polite"
          className="text-muted-foreground hidden text-sm tabular-nums lg:inline"
        >
          <span className="text-foreground font-medium">
            {total.toLocaleString("es-MX")}
          </span>{" "}
          {total === 1 ? "persona" : "personas"}
        </span>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {children}
        </div>
      </div>
    </FilterBar>
  );
};
