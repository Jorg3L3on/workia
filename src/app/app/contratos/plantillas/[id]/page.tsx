import type { Metadata } from "next";
import { CircleSlashIcon, Trash2Icon } from "lucide-react";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { activeTone } from "@/lib/ui/status-tone";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
import {
  deactivateContractTemplateAction,
  deleteContractTemplateAction,
  updateContractTemplateAction,
} from "@/lib/contracts/actions";
import { getContractTemplateById } from "@/lib/contracts";
import { requireContractTemplatesRead } from "@/lib/contracts/auth";
import { TemplateTokensHelp } from "@/components/contracts/template-tokens-help";
import { userHasPermission } from "@/lib/rbac";
import { CompanyField } from "@/components/tenant/company-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.plantilla,
};

type PlantillaDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
};

const PlantillaDetailPage = async ({
  params,
  searchParams,
}: PlantillaDetailPageProps) => {
  const session = await requireContractTemplatesRead();
  const { id } = await params;
  const { saved, error } = await searchParams;

  const [template, canUpdate, canDelete] = await Promise.all([
    getContractTemplateById(session.companyId, id),
    userHasPermission(session.user.id, "contract_templates:update"),
    userHasPermission(session.user.id, "contract_templates:delete"),
  ]);

  if (!template) {
    notFound();
  }

  const updateAction = updateContractTemplateAction.bind(null, id);
  const deactivateAction = deactivateContractTemplateAction.bind(null, id);
  const deleteAction = deleteContractTemplateAction.bind(null, id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageBreadcrumbLabel label={template.name} />
      <PageHeader
        menu={
          canDelete
            ? [
                template.active && {
                  label: "Desactivar",
                  icon: CircleSlashIcon,
                  action: deactivateAction,
                },
                {
                  label: "Eliminar plantilla",
                  icon: Trash2Icon,
                  action: deleteAction,
                  destructive: true,
                  confirm: {
                    title: `Eliminar «${template.name}»`,
                    description:
                      "La plantilla deja de estar disponible para emitir contratos. Los contratos ya emitidos no cambian.",
                    confirmLabel: "Eliminar plantilla",
                  },
                },
              ]
            : null
        }
        primary={
          canUpdate
            ? { label: "Guardar cambios", form: "plantilla-form" }
            : null
        }
        status={
          <Badge tone={activeTone(template.active)}>
            {template.active ? "Activa" : "Inactiva"}
          </Badge>
        }
        title={template.name}
        variant="detail"
      />

      {saved === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Cambios guardados.
        </p>
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          No se pudo guardar la plantilla.
        </p>
      ) : null}

      {canUpdate ? (
        <form
          action={updateAction}
          className="workia-pass-card space-y-4 p-5"
          id="plantilla-form"
        >
          <CompanyField />
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input
              defaultValue={template.name}
              id="name"
              name="name"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Cuerpo</Label>
            <textarea
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-48 w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-3"
              defaultValue={template.body}
              id="body"
              name="body"
              required
            />
            <TemplateTokensHelp />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              defaultChecked={template.active}
              name="active"
              type="checkbox"
              value="true"
            />
            Plantilla activa
          </label>
        </form>
      ) : (
        <div className="workia-pass-card p-5">
          <pre className="text-sm whitespace-pre-wrap">{template.body}</pre>
        </div>
      )}
    </div>
  );
};

export default PlantillaDetailPage;
