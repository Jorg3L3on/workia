"use client";

import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatDateMx, isoToday } from "@/lib/format/date";
import { cn } from "@/lib/utils";

export type FilterChipOption = { value: string; label: string };

/** One filter: a chip that opens its options and shows the active value. */
export type FilterChipConfig = {
  id: string;
  label: string;
  /** "" means no filter. */
  value: string;
  options: FilterChipOption[];
  onChange: (value: string) => void;
};

export type FilterDateRangeConfig = {
  label?: string;
  /** ISO dates (YYYY-MM-DD), "" when open. */
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
};

/** A text filter that lives in the «Avanzado» popover (e.g. ID de recurso). */
export type FilterAdvancedField = {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
};

export type FilterBarSearch = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** Waits for typing to stop (server search); 0 applies at once. */
  debounceMs?: number;
};

export type FilterBarProps = {
  search?: FilterBarSearch;
  filters?: FilterChipConfig[];
  dateRange?: FilterDateRangeConfig;
  advanced?: FilterAdvancedField[];
  /** Clears every filter and the search at once (one URL update). */
  onClear?: () => void;
  /** Extra controls after the chips (e.g. a view switch). */
  children?: ReactNode;
  className?: string;
};

const SEARCH_DEBOUNCE_MS = 300;
const MANY_OPTIONS = 8;

/** Keeps a text box responsive while its value reaches the owner later. */
const useDebouncedText = (
  value: string,
  onChange: (value: string) => void,
  delay: number,
) => {
  const [text, setText] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  // What this box last sent; the owner echoing it back is not a reset.
  const [sent, setSent] = useState(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // The owner changed it (Limpiar, back button): follow it.
  if (value !== lastValue) {
    setLastValue(value);

    if (value !== sent) {
      setSent(value);
      setText(value);
    }
  }

  useEffect(() => {
    if (text.trim() === value.trim() || delay === 0) {
      return;
    }

    const timer = setTimeout(() => {
      setSent(text.trim());
      onChangeRef.current(text.trim());
    }, delay);

    return () => clearTimeout(timer);
  }, [text, value, delay]);

  const update = (next: string) => {
    setText(next);

    if (delay === 0) {
      setSent(next);
      onChangeRef.current(next);
    }
  };

  return [text, update] as const;
};

const SearchBox = ({ search }: { search: FilterBarSearch }) => {
  const id = useId();
  const [text, setText] = useDebouncedText(
    search.value,
    search.onChange,
    search.debounceMs ?? SEARCH_DEBOUNCE_MS,
  );

  return (
    <div className="relative min-w-0 flex-1 md:max-w-sm">
      <SearchIcon
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        aria-label={search.ariaLabel ?? search.placeholder ?? "Buscar"}
        className="bg-card h-9 pl-9"
        id={id}
        onChange={(event) => setText(event.target.value)}
        placeholder={search.placeholder ?? "Buscar…"}
        type="search"
        value={text}
      />
    </div>
  );
};

/** The chip look, shared with the Personas filter chips. */
export const chipClassName = (active: boolean) =>
  cn(
    "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
    active
      ? "border-transparent bg-primary/10 text-primary"
      : "border-input bg-card text-foreground hover:bg-muted",
  );

/** The chip's ✕: clears that one filter without opening it. */
export const ChipClear = ({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) => (
  <button
    aria-label={`Quitar filtro ${label}`}
    className="text-primary hover:bg-primary/15 -mr-1.5 inline-flex size-6 items-center justify-center rounded-md"
    onClick={onClear}
    type="button"
  >
    <XIcon aria-hidden className="size-3.5" />
  </button>
);

const OptionList = ({
  options,
  value,
  onPick,
}: {
  options: FilterChipOption[];
  value: string;
  onPick: (value: string) => void;
}) => {
  const [query, setQuery] = useState("");
  const shown = query
    ? options.filter((option) =>
        option.label.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;

  return (
    <div className="grid gap-1">
      {options.length > MANY_OPTIONS ? (
        <Input
          aria-label="Buscar opción"
          autoFocus
          className="h-8"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar…"
          value={query}
        />
      ) : null}
      <div className="grid max-h-64 overflow-y-auto" role="listbox">
        {shown.map((option) => {
          const selected = option.value === value;

          return (
            <button
              aria-selected={selected}
              className="hover:bg-muted focus-visible:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none"
              key={option.value}
              onClick={() => onPick(option.value)}
              role="option"
              type="button"
            >
              <CheckIcon
                aria-hidden
                className={cn("size-4 shrink-0", !selected && "invisible")}
              />
              <span className="min-w-0 truncate">{option.label}</span>
            </button>
          );
        })}
        {shown.length === 0 ? (
          <p className="text-muted-foreground px-2 py-1.5 text-sm">
            Sin resultados
          </p>
        ) : null}
      </div>
    </div>
  );
};

const FilterChip = ({ filter }: { filter: FilterChipConfig }) => {
  const [open, setOpen] = useState(false);
  const active = filter.value !== "";
  const current = filter.options.find(
    (option) => option.value === filter.value,
  );
  // The "all" option ("Todos…") stays out of the list: ✕ or Limpiar clear it.
  const options = filter.options.filter((option) => option.value !== "");

  return (
    <div className={chipClassName(active)} data-testid={`filter-${filter.id}`}>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <button
            aria-label={
              active ? `${filter.label}: ${current?.label}` : filter.label
            }
            className="inline-flex items-center gap-1.5 outline-none"
            type="button"
          >
            <span className={cn(active && "text-primary/80")}>
              {filter.label}
              {active ? ":" : null}
            </span>
            {active ? (
              <span className="max-w-40 truncate font-medium">
                {current?.label}
              </span>
            ) : (
              <ChevronDownIcon
                aria-hidden
                className="text-muted-foreground size-4"
              />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1.5">
          <OptionList
            onPick={(next) => {
              filter.onChange(next === filter.value ? "" : next);
              setOpen(false);
            }}
            options={options}
            value={filter.value}
          />
        </PopoverContent>
      </Popover>
      {active ? (
        <ChipClear label={filter.label} onClear={() => filter.onChange("")} />
      ) : null}
    </div>
  );
};

const daysAgo = (days: number) => {
  const today = new Date(`${isoToday()}T12:00:00`);
  today.setDate(today.getDate() - days);

  return today.toISOString().slice(0, 10);
};

const DATE_PRESETS = [
  { label: "Hoy", from: () => isoToday(), to: () => isoToday() },
  { label: "Últimos 7 días", from: () => daysAgo(6), to: () => isoToday() },
  { label: "Últimos 30 días", from: () => daysAgo(29), to: () => isoToday() },
] as const;

const dateRangeLabel = ({ from, to }: { from: string; to: string }) => {
  if (from && to) {
    return from === to
      ? formatDateMx(from)
      : `${formatDateMx(from)} – ${formatDateMx(to)}`;
  }

  return from ? `Desde ${formatDateMx(from)}` : `Hasta ${formatDateMx(to)}`;
};

const DateRangeChip = ({ range }: { range: FilterDateRangeConfig }) => {
  const id = useId();
  const label = range.label ?? "Fechas";
  const active = Boolean(range.from || range.to);

  return (
    <div className={chipClassName(active)} data-testid="filter-dates">
      <Popover>
        <PopoverTrigger asChild>
          <button
            aria-label={active ? `${label}: ${dateRangeLabel(range)}` : label}
            className="inline-flex items-center gap-1.5 outline-none"
            type="button"
          >
            <CalendarIcon
              aria-hidden
              className={cn("size-4", !active && "text-muted-foreground")}
            />
            <span className={cn(active && "font-medium")}>
              {active ? dateRangeLabel(range) : label}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="grid w-72 gap-3 p-3">
          <div className="flex flex-wrap gap-1.5">
            {DATE_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                onClick={() =>
                  range.onChange({ from: preset.from(), to: preset.to() })
                }
                size="sm"
                type="button"
                variant="secondary"
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${id}-from`}>Desde</Label>
              <Input
                id={`${id}-from`}
                max={range.to || undefined}
                onChange={(event) =>
                  range.onChange({ from: event.target.value, to: range.to })
                }
                type="date"
                value={range.from}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${id}-to`}>Hasta</Label>
              <Input
                id={`${id}-to`}
                min={range.from || undefined}
                onChange={(event) =>
                  range.onChange({ from: range.from, to: event.target.value })
                }
                type="date"
                value={range.to}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {active ? (
        <ChipClear
          label={label}
          onClear={() => range.onChange({ from: "", to: "" })}
        />
      ) : null}
    </div>
  );
};

const AdvancedInput = ({ field }: { field: FilterAdvancedField }) => {
  const id = useId();
  const [text, setText] = useDebouncedText(
    field.value,
    field.onChange,
    SEARCH_DEBOUNCE_MS,
  );

  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{field.label}</Label>
      <Input
        id={id}
        onChange={(event) => setText(event.target.value)}
        placeholder={field.placeholder}
        value={text}
      />
    </div>
  );
};

const AdvancedChip = ({ fields }: { fields: FilterAdvancedField[] }) => {
  const activeCount = fields.filter((field) => field.value !== "").length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={chipClassName(activeCount > 0)}
          data-testid="filter-advanced"
          type="button"
        >
          <SlidersHorizontalIcon aria-hidden className="size-4" />
          Avanzado{activeCount > 0 ? ` · ${activeCount}` : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-72 gap-3 p-3">
        {fields.map((field) => (
          <AdvancedInput field={field} key={field.id} />
        ))}
      </PopoverContent>
    </Popover>
  );
};

/**
 * The bar above a list: search on the left, a chip per filter, a date range
 * and «Limpiar». Every change applies at once (no «Filtrar» button). Below
 * 768px the chips fold into a «Filtros · N» bottom sheet; search stays.
 */
export const FilterBar = ({
  search,
  filters = [],
  dateRange,
  advanced = [],
  onClear,
  children,
  className,
}: FilterBarProps) => {
  const activeCount =
    filters.filter((filter) => filter.value !== "").length +
    (dateRange && (dateRange.from || dateRange.to) ? 1 : 0) +
    advanced.filter((field) => field.value !== "").length;
  const hasChips =
    filters.length > 0 || Boolean(dateRange) || advanced.length > 0;
  const showClear =
    Boolean(onClear) && (activeCount > 0 || Boolean(search?.value));

  const chips = (
    <>
      {filters.map((filter) => (
        <FilterChip filter={filter} key={filter.id} />
      ))}
      {dateRange ? <DateRangeChip range={dateRange} /> : null}
      {advanced.length > 0 ? <AdvancedChip fields={advanced} /> : null}
    </>
  );

  const clear = showClear ? (
    <Button
      className="text-muted-foreground h-9 px-2"
      onClick={onClear}
      type="button"
      variant="link"
    >
      Limpiar
    </Button>
  ) : null;

  if (!search && !hasChips && !children) {
    return null;
  }

  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      data-slot="filter-bar"
      role="search"
    >
      {search ? <SearchBox search={search} /> : null}

      {hasChips ? (
        <>
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            {chips}
            {clear}
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button
                className="h-9 md:hidden"
                type="button"
                variant="secondary"
              >
                <SlidersHorizontalIcon aria-hidden />
                {activeCount > 0 ? `Filtros · ${activeCount}` : "Filtros"}
              </Button>
            </SheetTrigger>
            <SheetContent className="rounded-t-xl pb-6" side="bottom">
              <SheetHeader>
                <SheetTitle>Filtros</SheetTitle>
              </SheetHeader>
              <div className="flex flex-wrap items-center gap-2 px-4">
                {chips}
              </div>
              {clear ? <div className="px-4">{clear}</div> : null}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        clear
      )}

      {children}
    </div>
  );
};
