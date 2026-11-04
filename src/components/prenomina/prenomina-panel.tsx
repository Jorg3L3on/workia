"use client";

import { DownloadIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Label } from "@/components/ui/label";
import {
  FORMAT_LABELS,
  LAYOUT_LABELS,
  PRENOMINA_COPY,
} from "@/lib/prenomina/copy";
import {
  PRENOMINA_FIELD_LABELS,
  type PrenominaFormat,
  type PrenominaLayout,
  type PersonField,
} from "@/lib/prenomina/template";

export type PrenominaPanelTemplate = {
  id: string;
  name: string;
  format: PrenominaFormat;
  layout: PrenominaLayout;
  rows: number;
  people: number;
  missing: Array<{ field: PersonField; people: number }>;
};

/**
 * Choose a template and download the closed quincena's file (W2-18). Before
 * the download it says how many rows the file has and which identifiers some
 * person lacks, so HR fixes them in the expediente instead of in the file.
 */
export const PrenominaPanel = ({
  period,
  templates,
  canExport,
}: {
  period: string;
  templates: PrenominaPanelTemplate[];
  canExport: boolean;
}) => {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const template =
    templates.find((item) => item.id === templateId) ?? templates[0];

  if (!template) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="prenomina-panel">
      <div className="flex flex-col gap-1.5 sm:max-w-sm">
        <Label htmlFor="prenomina-template">
          {PRENOMINA_COPY.templateLabel}
        </Label>
        <FormSelect
          id="prenomina-template"
          onValueChange={setTemplateId}
          options={templates.map((item) => ({
            value: item.id,
            label: item.name,
          }))}
          value={template.id}
          variant="field"
        />
      </div>
      <p className="text-muted-foreground text-sm">
        {FORMAT_LABELS[template.format]} · {LAYOUT_LABELS[template.layout]} ·{" "}
        {template.rows.toLocaleString("es-MX")}{" "}
        {template.rows === 1 ? "fila" : "filas"} de{" "}
        {template.people.toLocaleString("es-MX")}{" "}
        {template.people === 1 ? "persona" : "personas"}
      </p>
      {template.missing.length > 0 ? (
        <ul className="text-sm" data-testid="prenomina-missing" role="status">
          {template.missing.map((item) => (
            <li key={item.field}>
              {PRENOMINA_COPY.missing(
                PRENOMINA_FIELD_LABELS[item.field],
                item.people,
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {canExport ? (
        <div>
          <Button asChild variant="primary">
            <a
              data-testid="prenomina-download"
              download
              href={`/app/periodos/${period}/prenomina?plantilla=${encodeURIComponent(template.id)}`}
            >
              <DownloadIcon aria-hidden />
              {PRENOMINA_COPY.download}
            </a>
          </Button>
        </div>
      ) : null}
      <p className="text-muted-foreground text-sm">{PRENOMINA_COPY.noSalary}</p>
    </div>
  );
};
