import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";

import { pageTitles } from "@/lib/brand/chrome-copy";

import { AuditEventList } from "@/components/audit/audit-event-list";
import { PersonContractsSection } from "@/components/contracts/person-contracts-section";
import { PersonAssetsSection } from "@/components/resguardo/person-assets-section";
import { DeletePersonButton } from "@/components/people/delete-person-button";
import { PersonForm } from "@/components/people/person-form";
import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listAuditEvents } from "@/lib/audit";
import {
  listActiveAreas,
  listActivePositions,
  listActivitiesForPosition,
} from "@/lib/catalog";
import {
  listActiveContractTemplates,
  listContractsByPerson,
} from "@/lib/contracts";
import { listAssetsByPerson } from "@/lib/resguardo";
import {
  getPersonWithRelations,
  listActivePeopleForSelect,
} from "@/lib/people";
import { requirePeopleRead } from "@/lib/people/auth";
import {
  formatDateLabel,
  formatPersonName,
  personDeletedLabel,
  personIsDeleted,
  personStatusLabels,
} from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";
import { listActiveSites } from "@/lib/sites";
import { siteKindLabels } from "@/lib/sites/schema";

export const metadata: Metadata = {
  title: pageTitles.expediente,
};

const buildSiteLabel = (
  site?: { name: string; kind: "corporativo" | "sucursal" } | null,
) => {
  if (!site) {
    return "";
  }

  return `${site.name} (${siteKindLabels[site.kind]})`;
};

export const dynamic = "force-dynamic";

type PersonaDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    edit?: string;
    saved?: string;
    contract?: string;
    emit?: string;
  }>;
};

const PersonaDetailPage = async ({
  params,
  searchParams,
}: PersonaDetailPageProps) => {
  const session = await requirePeopleRead();
  const { id } = await params;
  const { edit, saved, contract, emit } = await searchParams;

  const [
    person,
    canUpdate,
    canDelete,
    canReadAudit,
    canReadContracts,
    canCreateContracts,
    canReadAssets,
    areas,
    positions,
    sites,
    managers,
    auditEvents,
    personContracts,
    contractTemplates,
    personAssets,
  ] = await Promise.all([
    getPersonWithRelations(id, true),
    userHasPermission(session.user.id, "people:update"),
    userHasPermission(session.user.id, "people:delete"),
    userHasPermission(session.user.id, "audit:read"),
    userHasPermission(session.user.id, "contracts:read"),
    userHasPermission(session.user.id, "contracts:create"),
    userHasPermission(session.user.id, "assets:read"),
    listActiveAreas(),
    listActivePositions(),
    listActiveSites(),
    listActivePeopleForSelect(id),
    listAuditEvents({ resourceType: "person", resourceId: id, limit: 50 }),
    listContractsByPerson(id),
    listActiveContractTemplates(),
    userHasPermission(session.user.id, "assets:read").then((allowed) =>
      allowed ? listAssetsByPerson(id) : Promise.resolve([]),
    ),
  ]);

  if (!person) {
    notFound();
  }

  const positionActivities = person.position
    ? await listActivitiesForPosition(person.position.id)
    : [];

  const isDeleted = personIsDeleted(person);
  const isEditing = edit === "1" && canUpdate && !isDeleted;
  const personName = formatPersonName(person);

  if (isEditing) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageBreadcrumbLabel label={personName} />
        <PersonForm
          areas={areas}
          managers={managers}
          mode="edit"
          person={person}
          positions={positions}
          sites={sites}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageBreadcrumbLabel label={personName} />
      <div className="workia-pass-card space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
              Expediente
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {formatPersonName(person)}
            </h1>
            <p className="text-muted-foreground text-sm">
              Datos de empresa, identificadores y relación laboral.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={person.status === "activa" ? "default" : "secondary"}
            >
              {personStatusLabels[person.status]}
            </Badge>
            {isDeleted ? (
              <Badge variant="destructive">{personDeletedLabel}</Badge>
            ) : null}
          </div>
        </div>

        {isDeleted ? (
          <p
            className="border-border/70 bg-muted/40 rounded-lg border px-3 py-2 text-sm"
            role="status"
          >
            Expediente borrado el {formatDateLabel(person.deletedAt)}. Sigue
            disponible para consulta; no se restauró el registro.
          </p>
        ) : null}

        {saved === "1" ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
            role="status"
          >
            Cambios guardados.
          </p>
        ) : null}

        {contract === "created" ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
            role="status"
          >
            Contrato emitido y guardado en el expediente.
          </p>
        ) : null}

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Nombre(s)</dt>
            <dd className="font-medium">{person.nombres}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Apellido paterno</dt>
            <dd className="font-medium">{person.apellidoPaterno}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Apellido materno</dt>
            <dd className="font-medium">{person.apellidoMaterno ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Fecha de ingreso</dt>
            <dd className="font-medium">
              {formatDateLabel(person.fechaIngreso)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Fecha de nacimiento</dt>
            <dd className="font-medium">
              {formatDateLabel(person.fechaNacimiento)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Ubicación</dt>
            <dd className="font-medium">
              {person.site
                ? `${person.site.name} (${siteKindLabels[person.site.kind]})`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Área</dt>
            <dd className="font-medium">{person.area?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Puesto</dt>
            <dd className="font-medium">{person.position?.name ?? "—"}</dd>
          </div>
          {person.position ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Actividades del puesto</dt>
              <dd>
                {positionActivities.length === 0 ? (
                  <span className="font-medium">—</span>
                ) : (
                  <ul className="list-disc space-y-1 pl-5">
                    {positionActivities.map((activity) => (
                      <li className="font-medium" key={activity.id}>
                        {activity.name}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Jefe directo</dt>
            <dd className="font-medium">
              {person.manager ? formatPersonName(person.manager) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">RFC</dt>
            <dd className="font-medium">{person.rfc ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">CURP</dt>
            <dd className="font-medium">{person.curp ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">NSS</dt>
            <dd className="font-medium">{person.nss ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Teléfono</dt>
            <dd className="font-medium">{person.telefono ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Correo</dt>
            <dd className="font-medium">{person.email ?? "—"}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-3 pt-1">
          {canUpdate && !isDeleted ? (
            <Button asChild variant="outline">
              <Link href={`/app/personas/${person.id}?edit=1`}>
                <PencilIcon className="size-4" aria-hidden />
                Editar
              </Link>
            </Button>
          ) : null}
          {canCreateContracts && canReadContracts && !isDeleted ? (
            <Button asChild variant="outline">
              <Link href={`/app/personas/${person.id}?emit=1`}>
                Emitir contrato
              </Link>
            </Button>
          ) : null}
          {canDelete && !isDeleted ? (
            <DeletePersonButton personId={person.id} />
          ) : null}
          <Button asChild variant="ghost">
            <Link
              href={isDeleted ? "/app/personas?deleted=1" : "/app/personas"}
            >
              {isDeleted ? "Ver listado de borrados" : "Volver al listado"}
            </Link>
          </Button>
        </div>
      </div>

      {canReadContracts ? (
        <PersonContractsSection
          canCreate={canCreateContracts}
          contracts={personContracts}
          personContext={{
            nombres: person.nombres,
            apellidoPaterno: person.apellidoPaterno,
            apellidoMaterno: person.apellidoMaterno,
            puesto: person.position?.name ?? null,
            area: person.area?.name ?? null,
            sucursal: buildSiteLabel(person.site),
            rfc: person.rfc,
          }}
          personId={person.id}
          showEmitForm={emit === "1" && !isDeleted}
          templates={contractTemplates}
        />
      ) : null}

      <PersonAssetsSection
        assets={personAssets}
        canReadAssets={canReadAssets}
      />

      {canReadAudit ? (
        <div className="workia-pass-card overflow-hidden">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-semibold">Historial de cambios</h2>
            <p className="text-muted-foreground text-sm">
              Quién cambió qué en este expediente.
            </p>
          </div>
          <AuditEventList
            emptyMessage="Aún no hay cambios registrados para esta persona."
            events={auditEvents}
            layout="inset"
          />
        </div>
      ) : null}
    </div>
  );
};

export default PersonaDetailPage;
