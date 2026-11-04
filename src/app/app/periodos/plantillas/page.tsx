import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { ArchiveTemplateButton } from "@/components/prenomina/archive-template-button";
import { PrenominaTemplateForm } from "@/components/prenomina/template-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { formatDateTimeMx } from "@/lib/format/date";
import { getPrenominaTemplate, listPrenominaTemplates } from "@/lib/prenomina";
import {
  archivePrenominaTemplateAction,
  savePrenominaTemplateAction,
} from "@/lib/prenomina/actions";
import { requirePrenominaRead } from "@/lib/prenomina/auth";
import {
  FORMAT_LABELS,
  LAYOUT_LABELS,
  PRENOMINA_COPY,
} from "@/lib/prenomina/copy";
import { DEFAULT_TEMPLATE } from "@/lib/prenomina/template";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.plantillasPrenomina,
};

type PlantillasPageProps = {
  searchParams: Promise<{ plantilla?: string }>;
};

/**
 * Pre-nómina templates (W2-18): the company's templates and, with
 * ?plantilla=nueva or a template id, the form (pay_periods:manage). The
 * built-in template can be copied but not changed.
 */
const PlantillasPage = async ({ searchParams }: PlantillasPageProps) => {
  const session = await requirePrenominaRead();
  const { plantilla } = await searchParams;
  const canManage = session.permissions.has("pay_periods:manage");
  const templates = await listPrenominaTemplates(session.companyId);
  const editing =
    canManage && plantilla && plantilla !== "nueva"
      ? await getPrenominaTemplate(session.companyId, plantilla)
      : null;

  if (canManage && plantilla && plantilla !== "nueva" && !editing) {
    notFound();
  }

  const showForm = canManage && Boolean(plantilla);
  const initial = editing ?? {
    ...DEFAULT_TEMPLATE,
    name: "",
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={PRENOMINA_COPY.templatesDescription}
        primary={
          canManage && !showForm ? (
            <Button asChild variant="primary">
              <Link href="/app/periodos/plantillas?plantilla=nueva">
                <PlusIcon aria-hidden />
                {PRENOMINA_COPY.newTemplate}
              </Link>
            </Button>
          ) : null
        }
        title={PRENOMINA_COPY.templatesTitle}
        variant="detail"
      />
      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {editing && !editing.builtIn
                ? editing.name
                : PRENOMINA_COPY.newTemplate}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <PrenominaTemplateForm
              action={savePrenominaTemplateAction}
              id={editing && !editing.builtIn ? editing.id : null}
              initial={
                editing?.builtIn
                  ? { ...editing, name: `${editing.name} (copia)` }
                  : initial
              }
            />
          </CardContent>
        </Card>
      ) : null}
      <ul
        className="grid gap-4 md:grid-cols-2"
        data-testid="prenomina-templates"
      >
        {templates.map((template) => (
          <li key={template.id}>
            <Card>
              <CardHeader>
                <CardTitle>{template.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <p>
                  {FORMAT_LABELS[template.format]} ·{" "}
                  {LAYOUT_LABELS[template.layout]} · {template.columns.length}{" "}
                  {template.columns.length === 1 ? "columna" : "columnas"}
                </p>
                <p className="text-muted-foreground">
                  {template.builtIn
                    ? PRENOMINA_COPY.builtIn
                    : template.updatedAt
                      ? `Actualizada el ${formatDateTimeMx(template.updatedAt)}`
                      : null}
                </p>
                {canManage ? (
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="secondary">
                      <Link
                        href={`/app/periodos/plantillas?plantilla=${template.id}`}
                      >
                        {template.builtIn ? "Copiar" : PRENOMINA_COPY.edit}
                      </Link>
                    </Button>
                    {template.builtIn ? null : (
                      <ArchiveTemplateButton
                        action={archivePrenominaTemplateAction}
                        id={template.id}
                      />
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PlantillasPage;
