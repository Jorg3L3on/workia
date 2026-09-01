import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { pageTitles } from "@/lib/brand/chrome-copy";

import { AuditEventList } from "@/components/audit/audit-event-list";
import { AssignAssetForm } from "@/components/resguardo/assign-asset-form";
import { ReturnAssetForm } from "@/components/resguardo/return-asset-form";
import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
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
import { listAuditEvents } from "@/lib/audit";
import { getAssetWithHolder, listAssetMovements } from "@/lib/resguardo";
import { deleteAssetAction } from "@/lib/resguardo/actions";
import { requireAssetsRead } from "@/lib/resguardo/auth";
import {
  assetCategoryLabels,
  assetMovementTypeLabels,
  assetStatusLabels,
  formatAssetDate,
} from "@/lib/resguardo/schema";
import { listActivePeopleForSelect } from "@/lib/people";
import { formatPersonName } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.activo,
};

type AssetDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    created?: string;
    assigned?: string;
    returned?: string;
    assign?: string;
    return?: string;
    error?: string;
  }>;
};

const AssetDetailPage = async ({
  params,
  searchParams,
}: AssetDetailPageProps) => {
  const session = await requireAssetsRead();
  const { id } = await params;
  const {
    created,
    assigned,
    returned,
    assign,
    return: returnForm,
    error,
  } = await searchParams;

  const [
    asset,
    movements,
    canUpdate,
    canDelete,
    canReadAudit,
    people,
    auditEvents,
  ] = await Promise.all([
    getAssetWithHolder(id),
    listAssetMovements(id),
    userHasPermission(session.user.id, "assets:update"),
    userHasPermission(session.user.id, "assets:delete"),
    userHasPermission(session.user.id, "audit:read"),
    listActivePeopleForSelect(),
    listAuditEvents({ resourceType: "asset", resourceId: id, limit: 20 }),
  ]);

  if (!asset) {
    notFound();
  }

  const holderName = asset.holder ? formatPersonName(asset.holder) : null;
  const isAssigned = asset.status === "asignado" && asset.holderId;
  const canAssign =
    canUpdate &&
    asset.tracksHistory &&
    asset.status === "disponible" &&
    !isAssigned;
  const canReturn = canUpdate && asset.tracksHistory && isAssigned;
  const showAssignForm = assign === "1" && canAssign;
  const showReturnForm = returnForm === "1" && canReturn;

  const peopleOptions = people.map((person) => ({
    id: person.id,
    label: formatPersonName(person),
  }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageBreadcrumbLabel label={asset.name} />
      <div className="workia-pass-card space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
              Resguardo
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {asset.name}
            </h1>
            <p className="text-muted-foreground text-sm">
              {asset.identifier} ·{" "}
              {assetCategoryLabels[asset.category] ?? asset.category}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={asset.status === "asignado" ? "default" : "secondary"}
            >
              {assetStatusLabels[asset.status]}
            </Badge>
            {!asset.tracksHistory ? (
              <Badge variant="outline">Sin historial</Badge>
            ) : null}
          </div>
        </div>

        {created === "1" ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            role="status"
          >
            Activo registrado.
          </p>
        ) : null}

        {assigned === "1" ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            role="status"
          >
            Entrega registrada en el historial.
          </p>
        ) : null}

        {returned === "1" ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            role="status"
          >
            Devolución registrada en el historial.
          </p>
        ) : null}

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {decodeURIComponent(error)}
          </p>
        ) : null}

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Resguardante actual</dt>
            <dd className="font-medium">
              {holderName ? (
                <Link
                  className="text-primary hover:underline"
                  href={`/app/personas/${asset.holderId}`}
                >
                  {holderName}
                </Link>
              ) : (
                "En almacén"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Condición actual</dt>
            <dd className="font-medium">{asset.conditionNote ?? "—"}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-3 pt-1">
          {canAssign && !showAssignForm ? (
            <Button asChild variant="outline">
              <Link href={`/app/resguardo/${asset.id}?assign=1`}>Entregar</Link>
            </Button>
          ) : null}
          {canReturn && !showReturnForm ? (
            <Button asChild variant="outline">
              <Link href={`/app/resguardo/${asset.id}?return=1`}>Devolver</Link>
            </Button>
          ) : null}
          {canDelete && asset.status !== "asignado" ? (
            <form action={deleteAssetAction.bind(null, asset.id)}>
              <Button type="submit" variant="destructive">
                Dar de baja
              </Button>
            </form>
          ) : null}
          <Button asChild variant="ghost">
            <Link href="/app/resguardo">Volver al inventario</Link>
          </Button>
        </div>
      </div>

      {showAssignForm ? (
        <div className="workia-pass-card overflow-hidden">
          <AssignAssetForm assetId={asset.id} people={peopleOptions} />
        </div>
      ) : null}

      {showReturnForm && holderName ? (
        <div className="workia-pass-card overflow-hidden">
          <ReturnAssetForm assetId={asset.id} holderName={holderName} />
        </div>
      ) : null}

      {asset.tracksHistory ? (
        <div className="workia-pass-card overflow-hidden rounded-xl border">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-semibold">
              Historial de movimientos
            </h2>
            <p className="text-muted-foreground text-sm">
              Entregas y devoluciones — registro append-only, nunca se
              sobrescribe.
            </p>
          </div>

          {movements.length === 0 ? (
            <div className="workia-empty-state m-4 px-4 py-8 text-center">
              <p className="text-sm font-medium">Sin movimientos aún</p>
              <p className="text-muted-foreground mt-1 text-sm">
                La primera entrega quedará registrada aquí.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Persona</TableHead>
                  <TableHead>Condición</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((movement) => (
                  <TableRow key={movement.id} className="hover:bg-muted/40">
                    <TableCell className="text-muted-foreground">
                      {formatAssetDate(movement.movementDate)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          movement.type === "entrega" ? "default" : "secondary"
                        }
                      >
                        {assetMovementTypeLabels[movement.type]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Link
                        className="text-primary font-medium hover:underline"
                        href={`/app/personas/${movement.person.id}`}
                      >
                        {formatPersonName(movement.person)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {movement.conditionNote}
                      {movement.notes ? (
                        <span className="block text-xs">{movement.notes}</span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      ) : null}

      {canReadAudit ? (
        <div className="workia-pass-card overflow-hidden">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-semibold">Auditoría</h2>
            <p className="text-muted-foreground text-sm">
              Cambios registrados sobre este activo.
            </p>
          </div>
          <AuditEventList
            emptyMessage="Aún no hay eventos de auditoría para este activo."
            events={auditEvents}
          />
        </div>
      ) : null}
    </div>
  );
};

export default AssetDetailPage;
