"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import {
  formatScheduleBlocks,
  scheduleBlocksSchema,
  WEEK_DAYS,
  weekDayLabels,
  type ScheduleBlocks,
  type WeekDay,
} from "@/lib/people/schedule-blocks";
import { cn } from "@/lib/utils";

type BlockRow = {
  dias: WeekDay[];
  entrada: string;
  salida: string;
  comidaInicio: string;
  comidaFin: string;
};

type ScheduleBlocksEditorProps = {
  initial: ScheduleBlocks | null;
  error?: string;
};

const toRow = (block: ScheduleBlocks["bloques"][number]): BlockRow => ({
  dias: block.dias,
  entrada: block.entrada,
  salida: block.salida,
  comidaInicio: block.comidaInicio ?? "",
  comidaFin: block.comidaFin ?? "",
});

/**
 * Schedule by blocks (WRK-I5-3): days, entry, exit and an optional meal per
 * block, plus a rest day. Posts its value as JSON in `horarioBloques`.
 */
export const ScheduleBlocksEditor = ({
  initial,
  error,
}: ScheduleBlocksEditorProps) => {
  const [rows, setRows] = useState<BlockRow[]>(
    initial?.bloques.map(toRow) ?? [],
  );
  const [diaDescanso, setDiaDescanso] = useState<WeekDay | "">(
    initial?.diaDescanso ?? "",
  );
  const value = { bloques: rows, diaDescanso: diaDescanso || null };
  const parsed = scheduleBlocksSchema.safeParse(value);
  const used = new Set(rows.flatMap((row) => row.dias));
  const update = (index: number, patch: Partial<BlockRow>) =>
    setRows((current) =>
      current.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    );
  const toggleDay = (index: number, day: WeekDay) =>
    setRows((current) =>
      current.map((row, position) =>
        position === index
          ? {
              ...row,
              dias: row.dias.includes(day)
                ? row.dias.filter((item) => item !== day)
                : [...row.dias, day],
            }
          : row,
      ),
    );
  const nextDays = (): WeekDay[] => {
    const free = WEEK_DAYS.filter(
      (day) => !used.has(day) && day !== diaDescanso,
    );
    return rows.length === 0
      ? free.filter((day) => day !== "sab" && day !== "dom")
      : free.slice(0, 1);
  };

  return (
    <div
      className="bg-muted/30 space-y-3 rounded-lg border p-3 sm:p-4"
      data-testid="schedule-blocks-editor"
    >
      <input
        type="hidden"
        name="horarioBloques"
        value={JSON.stringify(value)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className={cn(
            "text-sm",
            parsed.success ? "text-muted-foreground" : "text-destructive",
          )}
          aria-live="polite"
        >
          {!parsed.success
            ? parsed.error.issues[0]?.message
            : rows.length === 0
              ? "Sin horario capturado."
              : formatScheduleBlocks(parsed.data)}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={rows.length >= 7 || used.size >= 7}
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                dias: nextDays(),
                entrada: "08:00",
                salida: current.length === 0 ? "17:00" : "13:00",
                comidaInicio: current.length === 0 ? "13:00" : "",
                comidaFin: current.length === 0 ? "14:00" : "",
              },
            ])
          }
        >
          <PlusIcon aria-hidden /> Agregar bloque
        </Button>
      </div>
      {rows.map((row, index) => (
        <fieldset
          key={index}
          className="bg-background space-y-3 rounded-lg border p-3"
          aria-label={`Bloque ${index + 1}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              className="flex flex-wrap gap-1"
              role="group"
              aria-label="Días"
            >
              {WEEK_DAYS.map((day) => {
                const pressed = row.dias.includes(day);
                return (
                  <Button
                    key={day}
                    type="button"
                    size="sm"
                    variant={pressed ? "primary" : "secondary"}
                    aria-pressed={pressed}
                    aria-label={weekDayLabels[day]}
                    className="h-8 min-w-10 px-2"
                    onClick={() => toggleDay(index, day)}
                  >
                    {weekDayLabels[day].slice(0, 3)}
                  </Button>
                );
              })}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Quitar bloque ${index + 1}`}
              onClick={() =>
                setRows((current) =>
                  current.filter((_, position) => position !== index),
                )
              }
            >
              <Trash2Icon aria-hidden />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["entrada", "Entrada"],
                ["salida", "Salida"],
                ["comidaInicio", "Comida inicio (opcional)"],
                ["comidaFin", "Comida fin (opcional)"],
              ] as const
            ).map(([field, label]) => (
              <div key={field} className="space-y-1">
                <label
                  className="text-xs font-medium"
                  htmlFor={`bloque-${index}-${field}`}
                >
                  {label}
                </label>
                <Input
                  id={`bloque-${index}-${field}`}
                  type="time"
                  value={row[field]}
                  onChange={(event) =>
                    update(index, { [field]: event.target.value })
                  }
                />
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="space-y-1 sm:max-w-56">
        <label className="text-xs font-medium" htmlFor="diaDescanso">
          Día de descanso (opcional)
        </label>
        <FormSelect
          id="diaDescanso"
          value={diaDescanso}
          onValueChange={(next) => setDiaDescanso(next as WeekDay | "")}
          options={[
            { value: "", label: "Sin capturar" },
            ...WEEK_DAYS.map((day) => ({
              value: day,
              label: weekDayLabels[day],
            })),
          ]}
          variant="field"
        />
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};
