"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  countPeopleFilterAction,
  countPeopleFilterOptionsAction,
} from "@/lib/people/filter/actions";
import type {
  PeopleFilterOption,
  PeopleFilterOptions,
} from "@/lib/people/filter/describe";
import type {
  PeopleFilterFieldDefinition,
  PeopleFilterFieldId,
} from "@/lib/people/filter/fields";
import {
  conditionFor,
  EMPTY_PEOPLE_FILTER,
  withCondition,
  type PeopleFilter,
} from "@/lib/people/filter/schema";

import { PeopleFilterFieldEditor } from "./people-filter-field-editor";

const SECTIONS = [
  { id: "persona", label: "Persona" },
  { id: "organizacion", label: "Organización" },
  { id: "baja", label: "Baja" },
  { id: "contrato", label: "Contrato" },
] as const;

const COUNT_DEBOUNCE_MS = 300;

/** How many people the draft would show, while it is being edited. */
const useDraftTotal = (draft: PeopleFilter, open: boolean, applied: number) => {
  const [total, setTotal] = useState<number | null>(applied);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void countPeopleFilterAction(draft).then((count) => {
        if (!cancelled) setTotal(count);
      });
    }, COUNT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, open]);

  return total;
};

export type PeopleFilterSheetProps = {
  filter: PeopleFilter;
  fields: PeopleFilterFieldDefinition[];
  options: PeopleFilterOptions;
  total: number;
  activeCount: number;
  today: string;
  onApply: (filter: PeopleFilter) => boolean;
  onPersonLabel: (option: PeopleFilterOption) => void;
};

/**
 * Phones: every field in one bottom sheet, by section. Changes stay in a
 * draft until «Ver N personas», where N is counted live on the server.
 */
export const PeopleFilterSheet = ({
  filter,
  fields,
  options,
  total,
  activeCount,
  today,
  onApply,
  onPersonLabel,
}: PeopleFilterSheetProps) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filter);
  // Limpiar remounts the editors, so none keeps a half-picked range.
  const [resetKey, setResetKey] = useState(0);
  const [counts, setCounts] = useState<
    Partial<Record<PeopleFilterFieldId, Record<string, number>>>
  >({});
  const draftTotal = useDraftTotal(draft, open, total);
  const draftCount = draft.conditions.length + (draft.deleted ? 1 : 0);

  const openSheet = (next: boolean) => {
    setOpen(next);

    if (!next) return;

    setDraft(filter);
    for (const field of fields.filter((item) => item.counts)) {
      void countPeopleFilterOptionsAction(filter, field.id).then((result) =>
        setCounts((current) => ({ ...current, [field.id]: result })),
      );
    }
  };

  return (
    <Sheet onOpenChange={openSheet} open={open}>
      <SheetTrigger asChild>
        <Button className="h-9 md:hidden" type="button" variant="secondary">
          <SlidersHorizontalIcon aria-hidden />
          {activeCount > 0 ? `Filtros · ${activeCount}` : "Filtros"}
        </Button>
      </SheetTrigger>
      <SheetContent
        className="max-h-[88dvh] gap-0 rounded-t-xl md:hidden"
        side="bottom"
      >
        <SheetHeader className="border-b">
          <SheetTitle>Filtros</SheetTitle>
          <SheetDescription>
            {draftCount === 0
              ? "Sin filtros"
              : draftCount === 1
                ? "1 activo"
                : `${draftCount} activos`}
          </SheetDescription>
        </SheetHeader>

        <div
          className="grid gap-6 overflow-y-auto overscroll-contain px-4 py-4"
          key={resetKey}
        >
          {SECTIONS.map((section) => {
            const sectionFields = fields.filter(
              (field) => field.section === section.id,
            );

            if (sectionFields.length === 0) return null;

            return (
              <section className="grid gap-4" key={section.id}>
                <h3 className="text-muted-foreground font-mono text-[10.5px] tracking-[0.09em] uppercase">
                  {section.label}
                </h3>
                {sectionFields.map((field) => (
                  <div className="grid gap-2" key={field.id}>
                    <p className="text-sm font-medium">{field.label}</p>
                    <PeopleFilterFieldEditor
                      condition={conditionFor(draft, field.id)}
                      counts={counts[field.id]}
                      field={field}
                      onChange={(condition) =>
                        setDraft((current) =>
                          withCondition(current, field.id, condition),
                        )
                      }
                      onPersonLabel={onPersonLabel}
                      options={options}
                      today={today}
                    />
                  </div>
                ))}
                {section.id === "persona" ? (
                  <div className="flex items-center justify-between gap-3">
                    <Label
                      className="text-sm font-medium"
                      htmlFor="filtro-borrados"
                    >
                      Sólo expedientes borrados
                    </Label>
                    <Switch
                      checked={draft.deleted}
                      id="filtro-borrados"
                      onCheckedChange={(deleted) =>
                        setDraft((current) => ({ ...current, deleted }))
                      }
                    />
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>

        <SheetFooter className="flex-row border-t">
          <Button
            onClick={() => {
              setDraft({ ...EMPTY_PEOPLE_FILTER, q: draft.q });
              setResetKey((key) => key + 1);
            }}
            type="button"
            variant="ghost"
          >
            Limpiar
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              if (onApply(draft)) setOpen(false);
            }}
            type="button"
          >
            {draftTotal === null
              ? "Ver personas"
              : `Ver ${draftTotal.toLocaleString("es-MX")} ${draftTotal === 1 ? "persona" : "personas"}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
