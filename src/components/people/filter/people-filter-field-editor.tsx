"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { es } from "react-day-picker/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { searchManagerOptionsAction } from "@/lib/people/actions";
import {
  dateRangePresets,
  optionsForField,
  type PeopleFilterOption,
  type PeopleFilterOptions,
} from "@/lib/people/filter/describe";
import {
  MAX_NEXT_DAYS,
  peopleFilterOperatorLabels,
  VENCE_PRESET_DAYS,
  type PeopleFilterFieldDefinition,
  type PeopleFilterOperator,
} from "@/lib/people/filter/fields";
import {
  isValuelessOperator,
  type PeopleFilterCondition,
} from "@/lib/people/filter/schema";
import { cn } from "@/lib/utils";

const MANY_OPTIONS = 8;
const SEARCH_DEBOUNCE_MS = 250;

export type PeopleFilterFieldEditorProps = {
  field: PeopleFilterFieldDefinition;
  condition: PeopleFilterCondition | undefined;
  /** Catalog options and the names of picked people. */
  options: PeopleFilterOptions;
  /** People per option under the rest of the filter; null while loading. */
  counts?: Record<string, number> | null;
  /** A complete condition, or null to remove the field. */
  onChange: (condition: PeopleFilterCondition | null) => void;
  /** Remembers a picked person's name for the chip. */
  onPersonLabel?: (option: PeopleFilterOption) => void;
  /** Mexico's date (ISO): the calendar shortcuts count from it. */
  today: string;
};

/** Local ISO date ↔ the calendar's Date (midday, so no timezone shifts a day). */
const toDate = (iso?: string) =>
  iso ? new Date(`${iso}T12:00:00`) : undefined;
const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const OperatorSelect = ({
  field,
  value,
  onChange,
}: {
  field: PeopleFilterFieldDefinition;
  value: PeopleFilterOperator;
  onChange: (op: PeopleFilterOperator) => void;
}) =>
  field.operators.length > 1 ? (
    <Select
      onValueChange={(next) => onChange(next as PeopleFilterOperator)}
      value={value}
    >
      <SelectTrigger
        aria-label={`Operador de ${field.label}`}
        className="h-8 w-full"
        size="sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {field.operators.map((op) => (
          <SelectItem key={op} value={op}>
            {peopleFilterOperatorLabels[op]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : null;

const OptionChecklist = ({
  label,
  options,
  selected,
  counts,
  onToggle,
  search,
  onSearch,
  loading,
  emptyText = "Sin resultados",
}: {
  label: string;
  options: PeopleFilterOption[];
  selected: readonly string[];
  counts?: Record<string, number> | null;
  onToggle: (option: PeopleFilterOption) => void;
  /** Server-side search (Jefe): the list is not filtered locally. */
  search?: string;
  onSearch?: (query: string) => void;
  loading?: boolean;
  emptyText?: string;
}) => {
  const searchable = Boolean(onSearch) || options.length > MANY_OPTIONS;

  return (
    <Command
      className="rounded-lg! border p-0"
      label={label}
      shouldFilter={!onSearch}
    >
      {searchable ? (
        <CommandInput
          aria-label={`Buscar en ${label}`}
          onValueChange={onSearch}
          placeholder="Buscar…"
          value={search}
        />
      ) : null}
      <CommandList className="max-h-60">
        <CommandEmpty>{loading ? "Buscando…" : emptyText}</CommandEmpty>
        <CommandGroup>
          {options.map((option) => {
            const checked = selected.includes(option.value);
            const count = counts?.[option.value];

            return (
              <CommandItem
                className={cn(count === 0 && !checked && "opacity-60")}
                key={option.value}
                keywords={[option.label]}
                onSelect={() => onToggle(option)}
                value={option.value}
              >
                <Checkbox
                  aria-hidden
                  checked={checked}
                  className="pointer-events-none"
                  tabIndex={-1}
                />
                <span className="min-w-0 flex-1 truncate">
                  {option.label}
                  {checked ? <span className="sr-only"> (marcado)</span> : null}
                </span>
                {counts ? (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {count ?? 0}
                  </span>
                ) : null}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
};

/** Search-as-you-type over active people for the Jefe field. */
const usePersonSearch = (query: string) => {
  const [results, setResults] = useState<PeopleFilterOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      void searchManagerOptionsAction(query)
        .then((rows) => {
          if (!cancelled) {
            setResults(
              rows.map((row) => ({ value: row.id, label: row.label })),
            );
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { results, loading };
};

const PersonValues = ({
  field,
  values,
  options,
  team,
  onChange,
  onPersonLabel,
}: {
  field: PeopleFilterFieldDefinition;
  values: string[];
  options: PeopleFilterOption[];
  team: boolean;
  onChange: (values: string[], team: boolean) => void;
  onPersonLabel?: (option: PeopleFilterOption) => void;
}) => {
  const id = useId();
  const [query, setQuery] = useState("");
  const { results, loading } = usePersonSearch(query);
  // The picked ones first, so they can be unticked; then the search results.
  const shown = useMemo(() => {
    const picked = values.map(
      (value) =>
        options.find((option) => option.value === value) ?? {
          value,
          label: "Persona",
        },
    );
    return [
      ...picked,
      ...results.filter((result) => !values.includes(result.value)),
    ];
  }, [options, results, values]);

  return (
    <div className="grid gap-3">
      <OptionChecklist
        emptyText="Escribe un nombre"
        label={field.label}
        loading={loading}
        onSearch={setQuery}
        onToggle={(option) => {
          onPersonLabel?.(option);
          onChange(
            values.includes(option.value)
              ? values.filter((value) => value !== option.value)
              : [...values, option.value],
            team,
          );
        }}
        options={shown}
        search={query}
        selected={values}
      />
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm font-normal" htmlFor={`${id}-team`}>
          Incluir todo el equipo
        </Label>
        <Switch
          checked={team}
          id={`${id}-team`}
          onCheckedChange={(checked) => onChange(values, checked)}
        />
      </div>
    </div>
  );
};

const DateValue = ({
  op,
  condition,
  today,
  onChange,
}: {
  op: PeopleFilterOperator;
  condition: PeopleFilterCondition | undefined;
  today: string;
  onChange: (range: { from?: string; to?: string }) => void;
}) => {
  const presets = useMemo(() => dateRangePresets(today), [today]);
  const current =
    condition?.op === op ? { from: condition.from, to: condition.to } : {};
  const activePreset = presets.find(
    (preset) => preset.from === current.from && preset.to === current.to,
  );
  const [custom, setCustom] = useState(Boolean(current.from) && !activePreset);
  const [range, setRange] = useState<DateRange | undefined>(
    current.from
      ? { from: toDate(current.from), to: toDate(current.to) }
      : undefined,
  );

  if (op !== "between") {
    return (
      <Calendar
        className="mx-auto"
        locale={es}
        mode="single"
        onSelect={(date) => onChange({ from: date ? toIso(date) : undefined })}
        selected={toDate(current.from)}
      />
    );
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <Button
            aria-pressed={activePreset?.id === preset.id && !custom}
            key={preset.id}
            onClick={() => {
              setCustom(false);
              setRange({ from: toDate(preset.from), to: toDate(preset.to) });
              onChange({ from: preset.from, to: preset.to });
            }}
            size="sm"
            type="button"
            variant={
              activePreset?.id === preset.id && !custom
                ? "primary"
                : "secondary"
            }
          >
            {preset.label}
          </Button>
        ))}
        <Button
          aria-pressed={custom}
          onClick={() => setCustom(true)}
          size="sm"
          type="button"
          variant={custom ? "primary" : "secondary"}
        >
          Personalizado
        </Button>
      </div>
      {custom ? (
        <Calendar
          className="mx-auto"
          defaultMonth={range?.from}
          locale={es}
          mode="range"
          onSelect={(next) => {
            setRange(next);
            if (next?.from && next.to) {
              onChange({ from: toIso(next.from), to: toIso(next.to) });
            }
          }}
          selected={range}
        />
      ) : null}
    </div>
  );
};

const DaysValue = ({
  days,
  onChange,
}: {
  days: number | undefined;
  onChange: (days: number) => void;
}) => {
  const id = useId();

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {VENCE_PRESET_DAYS.map((preset) => (
          <Button
            aria-pressed={days === preset}
            key={preset}
            onClick={() => onChange(preset)}
            size="sm"
            type="button"
            variant={days === preset ? "primary" : "secondary"}
          >
            {preset} días
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-sm font-normal" htmlFor={id}>
          Otro
        </Label>
        <Input
          className="h-8 w-24"
          id={id}
          inputMode="numeric"
          max={MAX_NEXT_DAYS}
          min={1}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            if (next >= 1 && next <= MAX_NEXT_DAYS) onChange(next);
          }}
          type="number"
          defaultValue={
            days && !VENCE_PRESET_DAYS.includes(days as 30) ? days : ""
          }
        />
        <span className="text-muted-foreground text-sm">días</span>
      </div>
    </div>
  );
};

/**
 * The operator and value of one field: checkboxes with counts for lists, a
 * person search with «incluir todo el equipo» for Jefe, a calendar with
 * shortcuts for dates, presets for days. Used by the chip popover and by
 * the mobile sheet.
 */
export const PeopleFilterFieldEditor = ({
  field,
  condition,
  options,
  counts,
  onChange,
  onPersonLabel,
  today,
}: PeopleFilterFieldEditorProps) => {
  const [op, setOp] = useState<PeopleFilterOperator>(
    condition?.op ?? field.operators[0],
  );
  const fieldOptions = optionsForField(field, options);
  const values = condition?.values ?? [];

  const changeOp = (next: PeopleFilterOperator) => {
    setOp(next);

    if (isValuelessOperator(next)) {
      onChange({ field: field.id, op: next });
    } else if ((next === "is" || next === "is_not") && values.length > 0) {
      onChange({ ...condition, field: field.id, op: next, values });
    } else if (next === "next_days") {
      onChange({ field: field.id, op: next, days: VENCE_PRESET_DAYS[0] });
    } else if (condition && condition.op !== next) {
      // A date operator waits for its date.
      onChange(null);
    }
  };

  const setValues = (next: string[], team = Boolean(condition?.team)) =>
    onChange(
      next.length > 0
        ? {
            field: field.id,
            op: op === "is_not" ? "is_not" : "is",
            values: next,
            ...(team ? { team: true } : {}),
          }
        : null,
    );

  return (
    <div className="grid gap-3">
      <OperatorSelect field={field} onChange={changeOp} value={op} />

      {isValuelessOperator(op) ? null : field.kind === "person" ? (
        <PersonValues
          field={field}
          onChange={setValues}
          onPersonLabel={onPersonLabel}
          options={fieldOptions}
          team={Boolean(condition?.team)}
          values={values}
        />
      ) : field.kind === "date" ? (
        <DateValue
          condition={condition}
          onChange={({ from, to }) =>
            onChange(
              from && (op !== "between" || to)
                ? { field: field.id, op, from, ...(to ? { to } : {}) }
                : null,
            )
          }
          op={op}
          today={today}
        />
      ) : field.kind === "days" ? (
        <DaysValue
          days={condition?.days}
          onChange={(days) => onChange({ field: field.id, op, days })}
        />
      ) : (
        <OptionChecklist
          counts={field.counts ? counts : undefined}
          label={field.label}
          onToggle={(option) =>
            setValues(
              values.includes(option.value)
                ? values.filter((value) => value !== option.value)
                : [...values, option.value],
            )
          }
          options={fieldOptions}
          selected={values}
          emptyText={
            fieldOptions.length === 0 ? "Aún no hay opciones" : undefined
          }
        />
      )}
    </div>
  );
};
