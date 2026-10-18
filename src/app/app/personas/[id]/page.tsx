import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PencilIcon } from "lucide-react";

import { pageTitles } from "@/lib/brand/chrome-copy";

import { AuditEventList } from "@/components/audit/audit-event-list";
import { PersonContractsSection } from "@/components/contracts/person-contracts-section";
import { PersonAssetsSection } from "@/components/resguardo/person-assets-section";
import { PersonExpedienteTabs } from "@/components/people/person-expediente-tabs";
import { DeletePersonButton } from "@/components/people/delete-person-button";
import { PersonForm } from "@/components/people/person-form";
import { SectionSkeleton } from "@/components/loading/page-skeletons";
import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listAuditEvents } from "@/lib/audit";
import {
  listActiveAreas,
  listActivePositions,
  listActivitiesForPersonPosition,
} from "@/lib/catalog";
import {
  listActiveContractTemplates,
  listContractsByPerson,
} from "@/lib/contracts";
import { listAssetsByPerson } from "@/lib/resguardo";
import { getPersonWithRelations, listPersonBeneficiaries } from "@/lib/people";
import { requirePeopleRead } from "@/lib/people/auth";
import {
  formatDateLabel,
  formatHorarioToken,
  formatPersonName,
  maritalStatusLabels,
  personDeletedLabel,
  personIsDeleted,
  personStatusLabels,
  sexLabels,
} from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";
import { formatMexicanAddress } from "@/lib/people/schema";
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

const formatAddress = (person: {
  domicilioCalle: string | null;
  domicilioNumeroExterior: string | null;
  domicilioNumeroInterior: string | null;
  domicilioColonia: string | null;
  domicilioMunicipio: string | null;
  domicilioEstado: string | null;
  domicilioCodigoPostal: string | null;
}) => formatMexicanAddress(person);

type PersonaDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    edit?: string;
    saved?: string;
    contract?: string;
    emit?: string;
  }>;
};

const PersonHistory = async ({
  companyId,
  personId,
}: {
  companyId: string;
  personId: string;
}) => {
  const auditEvents = await listAuditEvents({
    companyId,
    resourceType: "person",
    resourceId: personId,
    limit: 50,
  });

  return (
    <AuditEventList
      emptyMessage="Aún no hay cambios registrados para esta persona."
      events={auditEvents}
      layout="inset"
    />
  );
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
    canSeeCompensation,
    personContracts,
    contractTemplates,
    personAssets,
    positionActivities,
    beneficiaries,
  ] = await Promise.all([
    getPersonWithRelations(session.companyId, id, true),
    userHasPermission(session.user.id, "people:update"),
    userHasPermission(session.user.id, "people:delete"),
    userHasPermission(session.user.id, "audit:read"),
    userHasPermission(session.user.id, "contracts:read"),
    userHasPermission(session.user.id, "contracts:create"),
    userHasPermission(session.user.id, "assets:read"),
    userHasPermission(session.user.id, "compensation:read"),
    listContractsByPerson(session.companyId, id),
    listActiveContractTemplates(session.companyId),
    userHasPermission(session.user.id, "assets:read").then((allowed) =>
      allowed ? listAssetsByPerson(session.companyId, id) : Promise.resolve([]),
    ),
    listActivitiesForPersonPosition(session.companyId, id),
    listPersonBeneficiaries(session.companyId, id),
  ]);

  if (!person) {
    notFound();
  }

  const isDeleted = personIsDeleted(person);
  const isEditing = edit === "1" && canUpdate && !isDeleted;
  const personName = formatPersonName(person);

  if (isEditing) {
    // Form options are only needed here; view mode never loads them.
    const [areas, positions, sites] = await Promise.all([
      listActiveAreas(session.companyId),
      listActivePositions(session.companyId),
      listActiveSites(session.companyId),
    ]);

    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageBreadcrumbLabel label={personName} />
        <PersonForm
          areas={areas}
          beneficiaries={beneficiaries.map((item) => ({
            nombre: item.nombre,
            parentesco: item.parentesco,
            porcentaje: item.porcentaje,
          }))}
          initialManager={
            person.manager
              ? {
                  id: person.manager.id,
                  label: formatPersonName(person.manager),
                }
              : null
          }
          mode="edit"
          person={person}
          positions={positions}
          schedule={person.schedule}
          sites={sites}
        />
      </div>
    );
  }

  const defaultTab =
    (emit === "1" || contract === "created") && canReadContracts && !isDeleted
      ? "contratos"
      : "datos";

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
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            role="status"
          >
            Cambios guardados.
          </p>
        ) : null}

        {contract === "created" ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            role="status"
          >
            Contrato emitido y guardado en el expediente.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
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
          {canReadContracts ? (
            <Button asChild variant="outline">
              <Link href={`/app/personas/${person.id}/constancia`}>
                Constancia de antigüedad
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

      <PersonExpedienteTabs
        key={defaultTab}
        contratos={
          canReadContracts ? (
            <PersonContractsSection
              canCreate={canCreateContracts}
              canSeeCompensation={canSeeCompensation}
              contracts={personContracts}
              personContext={{
                nombres: person.nombres,
                apellidoPaterno: person.apellidoPaterno,
                apellidoMaterno: person.apellidoMaterno,
                puesto: person.position?.name ?? null,
                area: person.area?.name ?? null,
                sucursal: buildSiteLabel(person.site),
                rfc: person.rfc,
                horario: formatHorarioToken(person.schedule),
              }}
              personId={person.id}
              showEmitForm={emit === "1" && !isDeleted}
              templates={contractTemplates}
            />
          ) : undefined
        }
        datos={
          <div className="workia-pass-card p-5 sm:p-6">
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
              <div className="sm:col-span-2" data-testid="person-schedule">
                <dt className="text-muted-foreground">Horario</dt>
                <dd className="font-medium">
                  {formatHorarioToken(person.schedule)}
                </dd>
              </div>
              {person.position ? (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">
                    Actividades del puesto
                  </dt>
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
              <div className="border-t pt-3 sm:col-span-2">
                <dt className="text-sm font-semibold">Datos México</dt>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Domicilio</dt>
                <dd className="font-medium">{formatAddress(person) ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Estado civil</dt>
                <dd className="font-medium">
                  {person.estadoCivil
                    ? maritalStatusLabels[person.estadoCivil]
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sexo</dt>
                <dd className="font-medium">
                  {person.sexo ? sexLabels[person.sexo] : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Lugar de nacimiento</dt>
                <dd className="font-medium">{person.lugarNacimiento ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Nacionalidad</dt>
                <dd className="font-medium">{person.nacionalidad ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  Clave de elector (INE)
                </dt>
                <dd className="font-medium">{person.ineClaveElector ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">Beneficiarios</dt>
                <dd>
                  {beneficiaries.length === 0 ? (
                    <span className="font-medium">—</span>
                  ) : (
                    <ul className="space-y-1">
                      {beneficiaries.map((item) => (
                        <li className="font-medium" key={item.id}>
                          {item.nombre} · {item.parentesco} ·{" "}
                          {item.porcentaje.toLocaleString("es-MX")} %
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        }
        defaultValue={defaultTab}
        historial={
          canReadAudit ? (
            <div className="workia-pass-card overflow-hidden">
              <div className="border-b px-5 py-4">
                <h2 className="text-base font-semibold">
                  Historial de cambios
                </h2>
                <p className="text-muted-foreground text-sm">
                  Quién cambió qué en este expediente.
                </p>
              </div>
              <Suspense fallback={<SectionSkeleton rows={3} />}>
                <PersonHistory companyId={session.companyId} personId={id} />
              </Suspense>
            </div>
          ) : undefined
        }
        resguardo={
          canReadAssets ? (
            <PersonAssetsSection
              assets={personAssets}
              canReadAssets={canReadAssets}
            />
          ) : undefined
        }
      />
    </div>
  );
};

export default PersonaDetailPage;
