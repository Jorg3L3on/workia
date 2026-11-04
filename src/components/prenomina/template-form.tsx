"use client";

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PayPeriodActionState } from "@/lib/pay-periods/copy";
import {
  DATE_FORMAT_LABELS,
  DELIMITER_LABELS,
  ENCODING_LABELS,
  FORMAT_LABELS,
  LAYOUT_LABELS,
  PRENOMINA_COPY,
} from "@/lib/prenomina/copy";
import {
  isConcept,
  LONG_FIELDS,
  MAX_CONCEPT_CODE,
  MAX_CONSTANT,
  MAX_HEADER,
  MAX_TEMPLATE_COLUMNS,
  MAX_TEMPLATE_NAME,
  PRENOMINA_CONCEPT_LABELS,
  PRENOMINA_CONCEPTS,
  PRENOMINA_DATE_FORMATS,
  PRENOMINA_DELIMITERS,
  PRENOMINA_ENCODINGS,
  PRENOMINA_FIELD_LABELS,
  PRENOMINA_FIELDS,
  PRENOMINA_FORMATS,
  PRENOMINA_LAYOUTS,
  type PrenominaColumn,
  type PrenominaTemplateConfig,
} from "@/lib/prenomina/template";

type SaveAction = (
  state: PayPeriodActionState,
  formData: FormData,
) => Promise<PayPeriodActionState & { id?: string }>;

const options = <T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
) => values.map((value) => ({ value, label: labels[value] }));

const fieldOptions = (layout: PrenominaTemplateConfig["layout"]) =>
  PRENOMINA_FIELDS.filter((field) =>
    layout === "long"
      ? !isConcept(field)
      : !(LONG_FIELDS as readonly string[]).includes(field),
  ).map((field) => ({ value: field, label: PRENOMINA_FIELD_LABELS[field] }));

/**
 * One pre-nómina template (W2-18): the file's format and shape, its columns
 * in order and, for one row per concept, the provider's concept codes. The
 * server validates the same schema (src/lib/prenomina/template.ts).
 */
export const PrenominaTemplateForm = ({
  id,
  initial,
  action,
}: {
  id: string | null;
  initial: PrenominaTemplateConfig;
  action: SaveAction;
}) => {
  const router = useRouter();
  const [config, setConfig] = useState<PrenominaTemplateConfig>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PrenominaTemplateConfig>(
    key: K,
    value: PrenominaTemplateConfig[K],
  ) => setConfig((current) => ({ ...current, [key]: value }));
  const setColumn = (index: number, patch: Partial<PrenominaColumn>) =>
    set(
      "columns",
      config.columns.map((column, at) =>
        at === index ? { ...column, ...patch } : column,
      ),
    );
  const move = (index: number, by: -1 | 1) => {
    const columns = [...config.columns];
    const [column] = columns.splice(index, 1);
    columns.splice(index + by, 0, column);
    set("columns", columns);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("template", JSON.stringify(config));
    if (id) data.set("id", id);

    setPending(true);
    setError(null);
    void action({}, data)
      .then((result) => {
        if (result.error) {
          setError(result.error);
          return;
        }

        toast.success(result.message ?? PRENOMINA_COPY.saved);
        router.push("/app/periodos/plantillas");
      })
      .finally(() => setPending(false));
  };

  return (
    <form
      className="flex flex-col gap-5"
      data-testid="prenomina-template-form"
      onSubmit={handleSubmit}
    >
      <CompanyField />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="template-name">Nombre</Label>
          <Input
            id="template-name"
            maxLength={MAX_TEMPLATE_NAME}
            onChange={(event) => set("name", event.target.value)}
            required
            value={config.name}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-format">Formato</Label>
          <FormSelect
            id="template-format"
            onValueChange={(value) => {
              const format = value as PrenominaTemplateConfig["format"];
              setConfig((current) => ({
                ...current,
                format,
                encoding:
                  format === "xlsx" && current.encoding === "latin1"
                    ? "utf8_bom"
                    : current.encoding,
              }));
            }}
            options={options(PRENOMINA_FORMATS, FORMAT_LABELS)}
            value={config.format}
            variant="field"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-layout">Filas</Label>
          <FormSelect
            id="template-layout"
            onValueChange={(value) => {
              const layout = value as PrenominaTemplateConfig["layout"];
              const allowed = new Set(
                fieldOptions(layout).map((option) => option.value),
              );
              const kept = config.columns.filter((column) =>
                allowed.has(column.field),
              );
              setConfig((current) => ({
                ...current,
                layout,
                columns:
                  layout === "long"
                    ? [
                        ...kept,
                        ...(kept.some((column) => column.field === "concepto")
                          ? []
                          : [
                              {
                                header: "Concepto",
                                field: "concepto" as const,
                              },
                            ]),
                        ...(kept.some((column) => column.field === "cantidad")
                          ? []
                          : [
                              {
                                header: "Cantidad",
                                field: "cantidad" as const,
                              },
                            ]),
                      ]
                    : kept.length > 0
                      ? kept
                      : [{ header: "CURP", field: "curp" }],
              }));
            }}
            options={options(PRENOMINA_LAYOUTS, LAYOUT_LABELS)}
            value={config.layout}
            variant="field"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-date">Fechas</Label>
          <FormSelect
            id="template-date"
            onValueChange={(value) =>
              set("dateFormat", value as PrenominaTemplateConfig["dateFormat"])
            }
            options={options(PRENOMINA_DATE_FORMATS, DATE_FORMAT_LABELS)}
            value={config.dateFormat}
            variant="field"
          />
        </div>
        {config.format === "csv" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-delimiter">Separador</Label>
              <FormSelect
                id="template-delimiter"
                onValueChange={(value) =>
                  set(
                    "delimiter",
                    value as PrenominaTemplateConfig["delimiter"],
                  )
                }
                options={options(PRENOMINA_DELIMITERS, DELIMITER_LABELS)}
                value={config.delimiter}
                variant="field"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="template-encoding">Codificación</Label>
              <FormSelect
                id="template-encoding"
                onValueChange={(value) =>
                  set("encoding", value as PrenominaTemplateConfig["encoding"])
                }
                options={options(PRENOMINA_ENCODINGS, ENCODING_LABELS)}
                value={config.encoding}
                variant="field"
              />
            </div>
          </>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={config.includeHeader}
            onCheckedChange={(checked) =>
              set("includeHeader", checked === true)
            }
          />
          {PRENOMINA_COPY.includeHeader}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={config.skipEmpty}
            disabled={config.layout === "long"}
            onCheckedChange={(checked) => set("skipEmpty", checked === true)}
          />
          {PRENOMINA_COPY.skipEmpty}
        </label>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">
          {PRENOMINA_COPY.columns}
        </legend>
        <p className="text-muted-foreground text-sm">
          {PRENOMINA_COPY.columnsHint}
        </p>
        <ol className="flex flex-col gap-2" data-testid="prenomina-columns">
          {config.columns.map((column, index) => (
            <li
              className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
              key={index}
            >
              <div className="flex flex-col gap-1">
                <Label className="sr-only" htmlFor={`column-${index}-field`}>
                  {PRENOMINA_COPY.field} {index + 1}
                </Label>
                <FormSelect
                  id={`column-${index}-field`}
                  onValueChange={(value) =>
                    // Radix Select reports "" while its options change.
                    value &&
                    setColumn(index, {
                      field: value as PrenominaColumn["field"],
                      value: value === "constante" ? column.value : undefined,
                    })
                  }
                  options={fieldOptions(config.layout)}
                  value={column.field}
                  variant="field"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="sr-only" htmlFor={`column-${index}-header`}>
                  {PRENOMINA_COPY.header} {index + 1}
                </Label>
                <Input
                  id={`column-${index}-header`}
                  maxLength={MAX_HEADER}
                  onChange={(event) =>
                    setColumn(index, { header: event.target.value })
                  }
                  placeholder={PRENOMINA_COPY.header}
                  value={column.header}
                />
              </div>
              <div className="flex flex-col gap-1">
                {column.field === "constante" ? (
                  <>
                    <Label
                      className="sr-only"
                      htmlFor={`column-${index}-value`}
                    >
                      {PRENOMINA_COPY.value} {index + 1}
                    </Label>
                    <Input
                      id={`column-${index}-value`}
                      maxLength={MAX_CONSTANT}
                      onChange={(event) =>
                        setColumn(index, { value: event.target.value })
                      }
                      placeholder={PRENOMINA_COPY.value}
                      value={column.value ?? ""}
                    />
                  </>
                ) : null}
              </div>
              <div className="flex gap-1">
                <Button
                  aria-label="Subir"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <ArrowUpIcon aria-hidden />
                </Button>
                <Button
                  aria-label="Bajar"
                  disabled={index === config.columns.length - 1}
                  onClick={() => move(index, 1)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <ArrowDownIcon aria-hidden />
                </Button>
                <Button
                  aria-label="Quitar"
                  disabled={config.columns.length === 1}
                  onClick={() =>
                    set(
                      "columns",
                      config.columns.filter((_, at) => at !== index),
                    )
                  }
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <XIcon aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <Button
            disabled={config.columns.length >= MAX_TEMPLATE_COLUMNS}
            onClick={() =>
              set("columns", [
                ...config.columns,
                { header: "", field: "nombre_completo" },
              ])
            }
            size="sm"
            type="button"
            variant="secondary"
          >
            <PlusIcon aria-hidden />
            {PRENOMINA_COPY.addColumn}
          </Button>
        </div>
      </fieldset>
      {config.layout === "long" ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">
            {PRENOMINA_COPY.conceptCodes}
          </legend>
          <p className="text-muted-foreground text-sm">
            {PRENOMINA_COPY.conceptCodesHint}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {PRENOMINA_CONCEPTS.map((concept) => (
              <div className="flex flex-col gap-1.5" key={concept}>
                <Label htmlFor={`code-${concept}`}>
                  {PRENOMINA_CONCEPT_LABELS[concept]}
                </Label>
                <Input
                  id={`code-${concept}`}
                  maxLength={MAX_CONCEPT_CODE}
                  onChange={(event) =>
                    set("conceptCodes", {
                      ...config.conceptCodes,
                      [concept]: event.target.value,
                    })
                  }
                  value={config.conceptCodes[concept] ?? ""}
                />
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          aria-busy={pending}
          disabled={pending}
          type="submit"
          variant="primary"
        >
          {pending ? "Guardando…" : PRENOMINA_COPY.save}
        </Button>
        <Button
          onClick={() => router.push("/app/periodos/plantillas")}
          type="button"
          variant="ghost"
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
};
