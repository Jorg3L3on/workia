import type { Metadata } from "next";
import Link from "next/link";
import { EllipsisIcon } from "lucide-react";
import { notFound } from "next/navigation";

import { pageTitles } from "@/lib/brand/chrome-copy";

import { AuditEventList } from "@/components/audit/audit-event-list";
import { AssignAssetForm } from "@/components/resguardo/assign-asset-form";
import { ReturnAssetForm } from "@/components/resguardo/return-asset-form";
import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
import { AssetMovementsTable } from "@/components/resguardo/assets-data-table";
import { Badge, Tag } from "@/components/ui/badge";
import { ActionMenuItem } from "@/components/ui/action-menu-item";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { listAuditEvents } from "@/lib/audit";
import { getAssetWithHolder, listAssetMovements } from "@/lib/resguardo";
import { deleteAssetAction } from "@/lib/resguardo/actions";
import { requireAssetsRead } from "@/lib/resguardo/auth";
import {
  assetCategoryLabels,
  assetMovementTypeLabels,
  assetStatusLabels,
} from "@/lib/resguardo/schema";
import { listActivePeopleForSelect } from "@/lib/people";
import { formatPersonName } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";
import { toneFor } from "@/lib/ui/status-tone";

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
    getAssetWithHolder(session.companyId, id),
    listAssetMovements(session.companyId, id),
    userHasPermission(session.user.id, "assets:update"),
    userHasPermission(session.user.id, "assets:delete"),
    userHasPermission(session.user.id, "audit:read"),
    listActivePeopleForSelect(session.companyId),
    listAuditEvents({
      companyId: session.companyId,
      resourceType: "asset",
      resourceId: id,
      limit: 20,
    }),
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
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {asset.name}
            </h1>
            <Badge tone={toneFor("asset", asset.status)}>
              {assetStatusLabels[asset.status]}
            </Badge>
            {!asset.tracksHistory ? <Tag>Sin historial</Tag> : null}
          </div>
          <p className="text-muted-foreground text-sm">
            <span className="font-mono">{asset.identifier}</span> ·{" "}
            {assetCategoryLabels[asset.category] ?? asset.category}
          </p>
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

        <div className="flex flex-wrap gap-2 pt-1">
          {canAssign && !showAssignForm ? (
            <Button asChild>
              <Link href={`/app/resguardo/${asset.id}?assign=1`}>Entregar</Link>
            </Button>
          ) : null}
          {canReturn && !showReturnForm ? (
            <Button asChild>
              <Link href={`/app/resguardo/${asset.id}?return=1`}>Devolver</Link>
            </Button>
          ) : null}
          {canDelete && asset.status !== "asignado" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label="Más acciones" variant="secondary">
                  <EllipsisIcon aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <ActionMenuItem
                  action={deleteAssetAction.bind(null, asset.id)}
                  variant="destructive"
                >
                  Dar de baja
                </ActionMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        <section className="space-y-3 pt-2">
          <div>
            <h2 className="text-base font-semibold">
              Historial de movimientos
            </h2>
            <p className="text-muted-foreground text-sm">
              Cada entrega y devolución queda registrada.
            </p>
          </div>

          <AssetMovementsTable
            movements={movements.map((movement) => ({
              id: movement.id,
              date: movement.movementDate,
              typeLabel: assetMovementTypeLabels[movement.type],
              personId: movement.person.id,
              personName: formatPersonName(movement.person),
              condition: [movement.conditionNote, movement.notes]
                .filter(Boolean)
                .join(" · "),
            }))}
          />
        </section>
      ) : null}

      {canReadAudit ? (
        <section className="space-y-3 pt-2">
          <div>
            <h2 className="text-base font-semibold">Auditoría</h2>
            <p className="text-muted-foreground text-sm">
              Cambios registrados sobre este activo.
            </p>
          </div>
          <AuditEventList
            emptyMessage="Aún no hay eventos de auditoría para este activo."
            events={auditEvents}
          />
        </section>
      ) : null}
    </div>
  );
};

export default AssetDetailPage;
