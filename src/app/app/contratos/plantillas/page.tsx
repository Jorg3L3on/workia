import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listContractTemplates } from "@/lib/contracts";
import { requireContractTemplatesRead } from "@/lib/contracts/auth";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
            Contratos
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Plantillas de contrato
          </h1>
          <p className="text-muted-foreground text-sm">
            Cuerpo con variables como {"{{nombres}}"}, {"{{puesto}}"} y{" "}
            {"{{sucursal}}"}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost">
            <Link href="/app/contratos">Volver a Contratos</Link>
          </Button>
          {canCreate ? (
            <Button asChild variant="outline">
              <Link href="/app/contratos/plantillas/nueva">
                <PlusIcon className="size-4" aria-hidden />
                Nueva plantilla
              </Link>
            </Button>
          ) : null}
        </div>
      </header>

      {saved === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
          role="status"
        >
          Plantilla guardada.
        </p>
      ) : null}

      {deactivated === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
          role="status"
        >
          Plantilla desactivada.
        </p>
      ) : null}

      {deleted === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
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

      <div className="workia-pass-card overflow-hidden">
        {templates.length === 0 ? (
          <div className="workia-empty-state m-4 px-4 py-8 text-center">
            <p className="text-sm font-medium">Sin plantillas</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Crea una plantilla para emitir contratos desde el expediente.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>
                    <Badge variant={template.active ? "default" : "secondary"}>
                      {template.active ? "Activa" : "Inactiva"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      className="workia-accent-text text-sm font-medium hover:underline"
                      href={`/app/contratos/plantillas/${template.id}`}
                    >
                      Editar
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};

export default PlantillasPage;
