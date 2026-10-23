"use client";

import {
  CalendarRangeIcon,
  CheckIcon,
  ChevronDownIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DateInput } from "@/components/ui/date-input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { terminationTypeLabels } from "@/lib/people/employment-schema";
import type { TurnoverFilter } from "@/lib/reports/turnover/schema";
import {
  presetOf,
  presetRange,
  TURNOVER_PRESETS,
  turnoverPresetLabels,
  type TurnoverPreset,
} from "@/lib/reports/turnover/url";
import {
  TERMINATION_CLASSIFICATIONS,
  terminationClassificationLabels,
} from "@/lib/termination-reasons/schema";
import { cn } from "@/lib/utils";

import { rangeLabel } from "./format";

export type FilterOption = { value: string; label: string };

export type TurnoverFilterOptions = {
  areas: FilterOption[];
  sites: FilterOption[];
  positions: FilterOption[];
  managers: FilterOption[];
  reasons: FilterOption[];
};

const TIPO_OPTIONS: FilterOption[] = (
  ["voluntaria", "despido", "termino_contrato", "otra"] as const
).map((value) => ({ value, label: terminationTypeLabels[value] }));

const CLASS_OPTIONS: FilterOption[] = TERMINATION_CLASSIFICATIONS.map(
  (value) => ({ value, label: terminationClassificationLabels[value] }),
);

type ListField =
  | "areaIds"
  | "siteIds"
  | "positionIds"
  | "tipos"
  | "motivoIds"
  | "classifications";

const triggerClass =
  "h-8 gap-1.5 rounded-md border-dashed px-2.5 text-sm font-normal";

/** A «campo ▾» button with a searchable checklist. */
const MultiSelect = ({
  label,
  options,
  selected,
  onChange,
  searchable = true,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
}) => {
  const toggle = (value: string) =>
    onChange(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className={cn(triggerClass, selected.length > 0 && "border-solid")}
          size="sm"
          variant="secondary"
        >
          {label}
          {selected.length > 0 ? (
            <span className="bg-primary/10 text-primary rounded px-1.5 text-xs font-medium tabular-nums">
              {selected.length}
            </span>
          ) : null}
          <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          {searchable ? (
            <CommandInput placeholder={`Buscar ${label.toLowerCase()}`} />
          ) : null}
          <CommandList>
            <CommandEmpty>Sin resultados.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const checked = selected.includes(option.value);

                return (
                  <CommandItem
                    key={option.value}
                    onSelect={() => toggle(option.value)}
                    value={`${option.label} ${option.value}`}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "border-input flex size-4 items-center justify-center rounded-sm border",
                        checked &&
                          "bg-primary border-primary text-primary-foreground",
                      )}
                    >
                      {checked ? <CheckIcon className="size-3" /> : null}
                    </span>
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

/** Jefe: one person, and whether to include the whole team below. */
const ManagerSelect = ({
  options,
  managerId,
  team,
  onChange,
}: {
  options: FilterOption[];
  managerId: string | null;
  team: boolean;
  onChange: (managerId: string | null, team: boolean) => void;
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button
        className={cn(triggerClass, managerId && "border-solid")}
        size="sm"
        variant="secondary"
      >
        Jefe
        {managerId ? (
          <span className="bg-primary/10 text-primary rounded px-1.5 text-xs font-medium">
            1
          </span>
        ) : null}
        <ChevronDownIcon aria-hidden className="size-3.5 opacity-60" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72 p-0">
      <Command>
        <CommandInput placeholder="Buscar jefe" />
        <CommandList>
          <CommandEmpty>Sin resultados.</CommandEmpty>
          <CommandGroup>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                onSelect={() =>
                  onChange(
                    managerId === option.value ? null : option.value,
                    team,
                  )
                }
                value={`${option.label} ${option.value}`}
              >
                <CheckIcon
                  aria-hidden
                  className={cn(
                    "size-4",
                    managerId === option.value ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">{option.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
      <div className="border-t p-3">
        <Label className="flex items-center justify-between gap-3 text-sm font-normal">
          Todo el equipo (no sólo directos)
          <Switch
            checked={team}
            disabled={!managerId}
            onCheckedChange={(checked) => onChange(managerId, checked)}
          />
        </Label>
      </div>
    </PopoverContent>
  </Popover>
);

/** Presets plus «Personalizado» with two dates. */
const RangePicker = ({
  filter,
  today,
  historyMonths,
  onChange,
}: {
  filter: TurnoverFilter;
  today: string;
  historyMonths: number;
  onChange: (range: { from: string; to: string }) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = presetOf(filter, today);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const from = String(data.get("from") ?? "");
    const to = String(data.get("to") ?? "");

    if (!from || !to) {
      setError("Escribe las dos fechas.");
      return;
    }

    if (from > to) {
      setError("La fecha inicial debe ser anterior a la final.");
      return;
    }

    setError(null);
    setOpen(false);
    onChange({ from, to });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div
        aria-label="Periodo"
        className="bg-muted flex flex-wrap gap-0.5 rounded-md p-0.5"
        role="group"
      >
        {TURNOVER_PRESETS.map((preset: TurnoverPreset) => {
          const needsYear = preset === "12m" && historyMonths < 12;
          const button = (
            <Button
              aria-pressed={current === preset}
              className={cn(
                "h-7 px-2.5 text-xs font-medium",
                current === preset
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground",
              )}
              disabled={needsYear}
              key={preset}
              onClick={() => onChange(presetRange(preset, today))}
              size="sm"
              variant="ghost"
            >
              {turnoverPresetLabels[preset]}
            </Button>
          );

          return needsYear ? (
            <Tooltip key={preset}>
              <TooltipTrigger asChild>
                <span>{button}</span>
              </TooltipTrigger>
              <TooltipContent>
                Necesita 12 meses de historia; hay {historyMonths}.
              </TooltipContent>
            </Tooltip>
          ) : (
            button
          );
        })}
      </div>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            className={cn(
              triggerClass,
              "border-solid",
              current === "custom" && "border-primary/50",
            )}
            size="sm"
            variant="secondary"
          >
            <CalendarRangeIcon aria-hidden className="size-3.5" />
            {current === "custom"
              ? rangeLabel(filter.from, filter.to)
              : turnoverPresetLabels.custom}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <form className="space-y-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="turnover-from">Desde</Label>
              <DateInput
                defaultValue={filter.from}
                id="turnover-from"
                name="from"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="turnover-to">Hasta</Label>
              <DateInput defaultValue={filter.to} id="turnover-to" name="to" />
            </div>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
            <Button className="w-full" size="sm" type="submit">
              Aplicar
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
};

type Chip = { key: string; label: string; remove: () => void };

/** The active filters as removable chips. */
const activeChips = (
  filter: TurnoverFilter,
  options: TurnoverFilterOptions,
  onChange: (next: TurnoverFilter) => void,
): Chip[] => {
  const nameIn = (list: FilterOption[], value: string) =>
    list.find((option) => option.value === value)?.label ?? "(Borrado)";
  const lists: [ListField, string, FilterOption[]][] = [
    ["areaIds", "Área", options.areas],
    ["siteIds", "Sucursal", options.sites],
    ["positionIds", "Puesto", options.positions],
    ["tipos", "Tipo", TIPO_OPTIONS],
    ["motivoIds", "Motivo", options.reasons],
    ["classifications", "Clasificación", CLASS_OPTIONS],
  ];
  const chips: Chip[] = [];

  for (const [field, label, list] of lists) {
    const values = filter[field] as string[];

    if (values.length === 0) continue;

    chips.push({
      key: field,
      label: `${label}: ${values.map((value) => nameIn(list, value)).join(", ")}`,
      remove: () => onChange({ ...filter, [field]: [] }),
    });
  }

  if (filter.managerId) {
    chips.push({
      key: "managerId",
      label: `Jefe: ${nameIn(options.managers, filter.managerId)}${filter.team ? " y su equipo" : ""}`,
      remove: () => onChange({ ...filter, managerId: null, team: false }),
    });
  }

  return chips;
};

export const TurnoverFilters = ({
  filter,
  options,
  today,
  historyMonths,
  pending,
  onChange,
}: {
  filter: TurnoverFilter;
  options: TurnoverFilterOptions;
  today: string;
  historyMonths: number;
  pending: boolean;
  onChange: (next: TurnoverFilter) => void;
}) => {
  const chips = activeChips(filter, options, onChange);
  const setList = (field: ListField) => (values: string[]) =>
    onChange({ ...filter, [field]: values });

  const controls: ReactNode = (
    <>
      <MultiSelect
        label="Área"
        onChange={setList("areaIds")}
        options={options.areas}
        selected={filter.areaIds}
      />
      <MultiSelect
        label="Sucursal"
        onChange={setList("siteIds")}
        options={options.sites}
        selected={filter.siteIds}
      />
      <MultiSelect
        label="Puesto"
        onChange={setList("positionIds")}
        options={options.positions}
        selected={filter.positionIds}
      />
      <ManagerSelect
        managerId={filter.managerId}
        onChange={(managerId, team) =>
          onChange({ ...filter, managerId, team: managerId ? team : false })
        }
        options={options.managers}
        team={filter.team}
      />
      <MultiSelect
        label="Tipo de baja"
        onChange={setList("tipos")}
        options={TIPO_OPTIONS}
        searchable={false}
        selected={filter.tipos}
      />
      <MultiSelect
        label="Motivo"
        onChange={setList("motivoIds")}
        options={options.reasons}
        selected={filter.motivoIds}
      />
      <MultiSelect
        label="Clasificación"
        onChange={setList("classifications")}
        options={CLASS_OPTIONS}
        searchable={false}
        selected={filter.classifications}
      />
    </>
  );

  return (
    <section
      aria-busy={pending}
      aria-label="Filtros del reporte"
      className={cn("space-y-2", pending && "opacity-70")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker
          filter={filter}
          historyMonths={historyMonths}
          onChange={(range) => onChange({ ...filter, ...range })}
          today={today}
        />
        <div className="hidden flex-wrap items-center gap-1.5 md:flex">
          {controls}
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button className="md:hidden" size="sm" variant="secondary">
              <SlidersHorizontalIcon aria-hidden />
              Filtros{chips.length > 0 ? ` (${chips.length})` : ""}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Filtros</SheetTitle>
              <SheetDescription>
                Área, sucursal, puesto y jefe cambian la plantilla; tipo, motivo
                y clasificación sólo las bajas que cuentan.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-wrap gap-2 px-4 pb-6">{controls}</div>
          </SheetContent>
        </Sheet>
      </div>
      {chips.length > 0 ? (
        <ul aria-label="Filtros activos" className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <li key={chip.key}>
              <span className="bg-muted inline-flex max-w-full items-center gap-1 rounded-md py-0.5 pr-0.5 pl-2 text-xs">
                <span className="truncate">{chip.label}</span>
                <Button
                  aria-label={`Quitar ${chip.label}`}
                  className="size-5"
                  onClick={chip.remove}
                  size="icon"
                  variant="ghost"
                >
                  <XIcon className="size-3" />
                </Button>
              </span>
            </li>
          ))}
          <li>
            <Button
              className="h-6 px-2 text-xs"
              onClick={() =>
                onChange({
                  ...filter,
                  areaIds: [],
                  siteIds: [],
                  positionIds: [],
                  managerId: null,
                  team: false,
                  tipos: [],
                  motivoIds: [],
                  classifications: [],
                })
              }
              size="sm"
              variant="ghost"
            >
              Limpiar filtros
            </Button>
          </li>
        </ul>
      ) : null}
    </section>
  );
};
