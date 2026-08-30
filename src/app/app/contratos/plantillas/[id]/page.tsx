import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
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
import { CONTRACT_TEMPLATE_TOKENS } from "@/lib/contracts/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

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
    getContractTemplateById(id),
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
      <header className="space-y-1">
        <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          Contratos
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {template.name}
        </h1>
      </header>

      {saved === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
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
        <form action={updateAction} className="workia-pass-card space-y-4 p-5">
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
            <p className="text-muted-foreground text-xs">
              Variables:{" "}
              {CONTRACT_TEMPLATE_TOKENS.map((token) => `{{${token}}}`).join(
                ", ",
              )}
            </p>
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

          <div className="flex flex-wrap gap-2">
            <Button
              className="workia-accent-gradient border-0 text-white shadow-md hover:opacity-95"
              type="submit"
            >
              Guardar cambios
            </Button>
            <Button asChild variant="ghost">
              <Link href="/app/contratos/plantillas">Volver</Link>
            </Button>
          </div>
        </form>
      ) : (
        <div className="workia-pass-card p-5">
          <pre className="text-sm whitespace-pre-wrap">{template.body}</pre>
        </div>
      )}

      {canDelete ? (
        <div className="flex flex-wrap gap-2">
          {template.active ? (
            <form action={deactivateAction}>
              <Button type="submit" variant="outline">
                Desactivar
              </Button>
            </form>
          ) : null}
          <form action={deleteAction}>
            <Button type="submit" variant="ghost">
              Eliminar plantilla
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
};

export default PlantillaDetailPage;
