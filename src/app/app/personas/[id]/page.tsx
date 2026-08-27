import Link from "next/link";
import { notFound } from "next/navigation";
import { PencilIcon } from "lucide-react";

import { AuditEventList } from "@/components/audit/audit-event-list";
import { DeletePersonButton } from "@/components/people/delete-person-button";
import { PersonForm } from "@/components/people/person-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listAuditEvents } from "@/lib/audit";
import { listActiveAreas, listActivePositions } from "@/lib/catalog";
import {
  getPersonWithRelations,
  listActivePeopleForSelect,
} from "@/lib/people";
import { requirePeopleRead } from "@/lib/people/auth";
import {
  formatDateLabel,
  formatPersonName,
  personStatusLabels,
} from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";
import { listActiveSites } from "@/lib/sites";
import { siteKindLabels } from "@/lib/sites/schema";

export const dynamic = "force-dynamic";

type PersonaDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; saved?: string }>;
};

const PersonaDetailPage = async ({
  params,
  searchParams,
}: PersonaDetailPageProps) => {
  const session = await requirePeopleRead();
  const { id } = await params;
  const { edit, saved } = await searchParams;

  const [
    person,
    canUpdate,
    canDelete,
    canReadAudit,
    areas,
    positions,
    sites,
    managers,
    auditEvents,
  ] = await Promise.all([
    getPersonWithRelations(id),
    userHasPermission(session.user.id, "people:update"),
    userHasPermission(session.user.id, "people:delete"),
    userHasPermission(session.user.id, "audit:read"),
    listActiveAreas(),
    listActivePositions(),
    listActiveSites(),
    listActivePeopleForSelect(id),
    listAuditEvents({ resourceType: "person", resourceId: id, limit: 50 }),
  ]);

  if (!person) {
    notFound();
  }

  const isEditing = edit === "1" && canUpdate;

  if (isEditing) {
    return (
      <div className="mx-auto w-full max-w-3xl">
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
          <Badge variant={person.status === "activa" ? "default" : "secondary"}>
            {personStatusLabels[person.status]}
          </Badge>
        </div>

        {saved === "1" ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
            role="status"
          >
            Cambios guardados.
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
          {canUpdate ? (
            <Button asChild variant="outline">
              <Link href={`/app/personas/${person.id}?edit=1`}>
                <PencilIcon className="size-4" aria-hidden />
                Editar
              </Link>
            </Button>
          ) : null}
          {canDelete ? <DeletePersonButton personId={person.id} /> : null}
          <Button asChild variant="ghost">
            <Link href="/app/personas">Volver al listado</Link>
          </Button>
        </div>
      </div>

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
          />
        </div>
      ) : null}
    </div>
  );
};

export default PersonaDetailPage;
