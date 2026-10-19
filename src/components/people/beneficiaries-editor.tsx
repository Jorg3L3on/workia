"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type BeneficiaryRow = {
  nombre: string;
  parentesco: string;
  porcentaje: number | string;
};

type BeneficiariesEditorProps = {
  initial: BeneficiaryRow[];
  error?: string;
};

const MAX_ROWS = 10;

/** Beneficiaries of the person; the percentages must add up to 100. */
export const BeneficiariesEditor = ({
  initial,
  error,
}: BeneficiariesEditorProps) => {
  const [rows, setRows] = useState<BeneficiaryRow[]>(initial);
  const total = rows.reduce(
    (sum, row) => sum + (Number(row.porcentaje) || 0),
    0,
  );
  const update = (index: number, patch: Partial<BeneficiaryRow>) =>
    setRows((current) =>
      current.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    );

  return (
    <div className="space-y-3" data-testid="beneficiaries-editor">
      <input type="hidden" name="beneficiariosEditor" value="1" />
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Sin beneficiarios capturados.
        </p>
      ) : null}
      {rows.map((row, index) => (
        <div
          key={index}
          className="grid gap-2 sm:grid-cols-[1fr_10rem_7rem_auto] sm:items-end"
        >
          <div className="space-y-1">
            <label
              className="text-xs font-medium"
              htmlFor={`beneficiario-nombre-${index}`}
            >
              Nombre
            </label>
            <Input
              id={`beneficiario-nombre-${index}`}
              name="beneficiarioNombre"
              value={row.nombre}
              onChange={(event) =>
                update(index, { nombre: event.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <label
              className="text-xs font-medium"
              htmlFor={`beneficiario-parentesco-${index}`}
            >
              Parentesco
            </label>
            <Input
              id={`beneficiario-parentesco-${index}`}
              name="beneficiarioParentesco"
              placeholder="Hija, cónyuge…"
              value={row.parentesco}
              onChange={(event) =>
                update(index, { parentesco: event.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <label
              className="text-xs font-medium"
              htmlFor={`beneficiario-porcentaje-${index}`}
            >
              %
            </label>
            <Input
              id={`beneficiario-porcentaje-${index}`}
              name="beneficiarioPorcentaje"
              type="number"
              min={1}
              max={100}
              step="0.01"
              value={row.porcentaje}
              onChange={(event) =>
                update(index, { porcentaje: event.target.value })
              }
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Quitar beneficiario ${index + 1}`}
            onClick={() =>
              setRows((current) =>
                current.filter((_, position) => position !== index),
              )
            }
          >
            <Trash2Icon aria-hidden />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={rows.length >= MAX_ROWS}
          onClick={() =>
            setRows((current) => [
              ...current,
              {
                nombre: "",
                parentesco: "",
                porcentaje: current.length === 0 ? 100 : "",
              },
            ])
          }
        >
          <PlusIcon aria-hidden /> Agregar beneficiario
        </Button>
        {rows.length > 0 ? (
          <span
            className={
              Math.abs(total - 100) < 0.01
                ? "text-muted-foreground text-xs"
                : "text-destructive text-xs"
            }
          >
            Total: {total.toLocaleString("es-MX")} %
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};
