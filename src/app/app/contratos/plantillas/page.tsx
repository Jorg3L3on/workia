import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { PlantillasDataTable } from "@/components/contracts/plantillas-data-table";
import {
  ListPageHeader,
  listPrimaryActionClassName,
} from "@/components/list/list-page-header";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { Button } from "@/components/ui/button";
import { listContractTemplates } from "@/lib/contracts";
import { requireContractTemplatesRead } from "@/lib/contracts/auth";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.plantillas,
};

type PlantillasPageProps = {
  searchParams: Promise<{
    saved?: string;
    deactivated?: string;
    deleted?: string;
    error?: string;
  }>;
};

const PlantillasPage = async ({ searchParams }: PlantillasPageProps) => {
  const session = await requireContractTemplatesRead();
  const { saved, deactivated, deleted, error } = await searchParams;

  const [templates, canCreate] = await Promise.all([
    listContractTemplates(true),
    userHasPermission(session.user.id, "contract_templates:create"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <ListPageHeader
        actions={
          <>
            <Button asChild className="h-10 rounded-full" variant="outline">
              <Link href="/app/contratos">Volver a Contratos</Link>
            </Button>
            {canCreate ? (
              <Button asChild className={listPrimaryActionClassName}>
                <Link href="/app/contratos/plantillas/nueva">
                  <PlusIcon className="size-4" aria-hidden />
                  Nueva plantilla
                </Link>
              </Button>
            ) : null}
          </>
        }
        description={
          <>
            Cuerpo con variables como {"{{nombres}}"}, {"{{puesto}}"} y{" "}
            {"{{sucursal}}"}.
          </>
        }
        descriptionSecondary="Lista de todas las plantillas registradas."
        title="Plantillas de contrato"
      />

      {saved === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Plantilla guardada.
        </p>
      ) : null}

      {deactivated === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Plantilla desactivada.
        </p>
      ) : null}

      {deleted === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Plantilla eliminada.
        </p>
      ) : null}

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          No se pudo completar la acción. Verifica tus permisos.
        </p>
      ) : null}

      <PlantillasDataTable
        templates={templates.map((template) => ({
          id: template.id,
          name: template.name,
          active: template.active,
        }))}
      />
    </div>
  );
};

export default PlantillasPage;
