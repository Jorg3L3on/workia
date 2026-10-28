import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FileSignatureIcon, PencilIcon } from "lucide-react";

import { pageTitles } from "@/lib/brand/chrome-copy";

import { PersonContractsSection } from "@/components/contracts/person-contracts-section";
import { PersonAssetsSection } from "@/components/resguardo/person-assets-section";
import { PersonActionsMenu } from "@/components/people/person-actions-menu";
import { PersonBajaCard } from "@/components/people/person-baja-card";
import { PersonCredential } from "@/components/people/person-credential";
import {
  DetailCard,
  DetailFieldList,
} from "@/components/people/person-detail-card";
import {
  DETAIL_CARDS,
  bajaDetails,
  contractFact,
  employmentPeriodItems,
  ingresoFact,
  isPersonFormField,
  isPersonFormSection,
  personEditHref,
  personInitials,
  seniorityAsOf,
  seniorityFact,
  type DetailCardId,
  type KeyFact,
} from "@/components/people/person-detail-model";
import { PersonEmploymentPeriods } from "@/components/people/person-employment-periods";
import { PersonForm } from "@/components/people/person-form";
import { PersonHistory } from "@/components/people/person-history";
import { PersonRehireButton } from "@/components/people/person-rehire-button";
import { PersonSectionNav } from "@/components/people/person-section-nav";
import { PersonVacationCard } from "@/components/people/person-vacation-card";
import { SectionSkeleton } from "@/components/loading/page-skeletons";
import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import {
  listActiveAreas,
  listActivePositions,
  listActivitiesForPersonPosition,
} from "@/lib/catalog";
import {
  listActiveContractTemplates,
  listContractsByPerson,
} from "@/lib/contracts";
import { contractTypeLabels, formatContractDate } from "@/lib/contracts/schema";
import { isoToday } from "@/lib/format/date";
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
import { deletedTone, toneFor } from "@/lib/ui/status-tone";
import {
  deletePersonAction,
  setPersonStatusAction,
  updateFiniquitoAction,
} from "@/lib/people/actions";
import {
  listEmploymentPeriods,
  summarizePeriods,
} from "@/lib/people/employment";
import { vacationEntitlementForPerson } from "@/lib/people/vacation-card";
import { serviceYearBalance } from "@/lib/vacations/balance";
import {
  registerVacationAction,
  voidVacationAction,
} from "@/lib/vacations/actions";
import { listVacationRecords } from "@/lib/vacations";
import { getPersonEmploymentMenuData } from "@/lib/people/employment-menu";

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
    /** With edit=1: the form section to open at (seccion-…). */
    seccion?: string;
    /** With seccion: the field to focus. */
    campo?: string;
    saved?: string;
    contract?: string;
    emit?: string;
    /** After «Dar de baja», «Reingresar» and «Finiquito» (setPersonStatusAction, updateFiniquitoAction). */
    baja?: string;
    reingreso?: string;
    finiquito?: string;
  }>;
};

/** Resguardo loads on its own so the rest of the expediente does not wait. */
const PersonAssetsCard = async ({
  companyId,
  personId,
}: {
  companyId: string;
  personId: string;
}) => {
  const assets = await listAssetsByPerson(companyId, personId);

  return (
    <PersonAssetsSection assets={assets} canReadAssets showHeading={false} />
  );
};

const PersonaDetailPage = async ({
  params,
  searchParams,
}: PersonaDetailPageProps) => {
  const session = await requirePeopleRead();
  const { id } = await params;
  const {
    edit,
    seccion,
    campo,
    saved,
    contract,
    emit,
    baja,
    reingreso,
    finiquito,
  } = await searchParams;

  const [
    person,
    canUpdate,
    canDelete,
    canReadAudit,
    canReadContracts,
    canCreateContracts,
    canUpdateContracts,
    canReadAssets,
    canSeeCompensation,
    canReadVacations,
    canCreateVacations,
    canUpdateVacations,
    positionActivities,
    beneficiaries,
    periods,
  ] = await Promise.all([
    getPersonWithRelations(session.companyId, id, true),
    userHasPermission(session.user.id, "people:update"),
    userHasPermission(session.user.id, "people:delete"),
    userHasPermission(session.user.id, "audit:read"),
    userHasPermission(session.user.id, "contracts:read"),
    userHasPermission(session.user.id, "contracts:create"),
    userHasPermission(session.user.id, "contracts:update"),
    userHasPermission(session.user.id, "assets:read"),
    userHasPermission(session.user.id, "compensation:read"),
    userHasPermission(session.user.id, "vacations:read"),
    userHasPermission(session.user.id, "vacations:create"),
    userHasPermission(session.user.id, "vacations:update"),
    listActivitiesForPersonPosition(session.companyId, id),
    listPersonBeneficiaries(session.companyId, id),
    listEmploymentPeriods(session.companyId, id),
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
    const initialSection = isPersonFormSection(seccion) ? seccion : undefined;

    return (
      <div className="mx-auto w-full max-w-5xl">
        <PageBreadcrumbLabel label={personName} />
        <PersonForm
          areas={areas}
          beneficiaries={beneficiaries.map((item) => ({
            nombre: item.nombre,
            parentesco: item.parentesco,
            porcentaje: item.porcentaje,
          }))}
          initialField={
            initialSection && isPersonFormField(campo) ? campo : undefined
          }
          initialManager={
            person.manager
              ? {
                  id: person.manager.id,
                  label: formatPersonName(person.manager),
                }
              : null
          }
          initialSection={initialSection}
          mode="edit"
          person={person}
          positions={positions}
          schedule={person.schedule}
          sites={sites}
        />
      </div>
    );
  }

  // Contracts (and their templates) only load for contracts:read.
  const [personContracts, contractTemplates] = canReadContracts
    ? await Promise.all([
        listContractsByPerson(session.companyId, id),
        listActiveContractTemplates(session.companyId),
      ])
    : [[], []];

  const today = isoToday();
  const canEdit = canUpdate && !isDeleted;
  const canEmit = canCreateContracts && canReadContracts && !isDeleted;
  const employment = canEdit
    ? await getPersonEmploymentMenuData(
        session.companyId,
        person.id,
        canSeeCompensation,
      )
    : undefined;
  // Bound once: the ⋯ menu and the baja block's «Reingresar» share it.
  const statusAction = canEdit
    ? setPersonStatusAction.bind(
        null,
        person.id,
        person.status === "baja" ? "activa" : "baja",
      )
    : undefined;
  // The current (or last) employment period; null before any period exists,
  // and then the page reads people.fecha_ingreso as it always did.
  const employmentSummary = summarizePeriods(periods);
  const isBaja = person.status === "baja";
  const vigente = personContracts.find((item) => item.status === "vigente");
  // «Decidir renovación» needs positions only when there is something to decide.
  const renewalPositions =
    canUpdateContracts && !isDeleted && vigente?.endDate
      ? (await listActivePositions(session.companyId)).map((position) => ({
          id: position.id,
          name: position.name,
        }))
      : [];
  const emitHref = `/app/personas/${person.id}?emit=1`;
  const personMeta = [
    person.position?.name,
    person.area?.name,
    person.site?.name,
  ]
    .filter(Boolean)
    .join(" · ");
  const horario = formatHorarioToken(person.schedule);
  // people:read (requirePeopleRead). asOf is explicit: today, or the baja.
  const vacation = vacationEntitlementForPerson({
    seniorityDate: employmentSummary
      ? employmentSummary.fechaAntiguedad
      : person.fechaIngreso,
    status: person.status,
    fechaBaja: employmentSummary?.fechaBaja ?? null,
    today,
  });
  const canSeeVacationLedger =
    canReadVacations || canCreateVacations || canUpdateVacations;
  const vacationHistory = canSeeVacationLedger
    ? await listVacationRecords(session.companyId, person.id)
    : [];
  const showVacationHistory = canReadVacations || canUpdateVacations;
  const vacationBalance =
    showVacationHistory &&
    vacation.serviceYearsCompleted !== null &&
    vacation.entitlementDays !== null
      ? serviceYearBalance({
          serviceYear: vacation.serviceYearsCompleted,
          entitlementDays: vacation.entitlementDays,
          entries: vacationHistory.map((record) => ({
            serviceYear: record.serviceYear,
            days: record.days,
            voided: false,
          })),
        })
      : null;
  const vacationLedger = canSeeVacationLedger
    ? {
        showHistory: showVacationHistory,
        records: showVacationHistory ? vacationHistory : [],
        existing: vacationHistory.map((record) => ({
          startDate: record.startDate,
          endDate: record.endDate,
          serviceYear: record.serviceYear,
          days: record.days,
          voided: false,
        })),
        takenHalves: vacationBalance?.takenHalves ?? null,
        remainingHalves: vacationBalance?.remainingHalves ?? null,
        exceedsEntitlement: vacationBalance?.exceedsEntitlement ?? false,
        canCreate: canCreateVacations && !isDeleted,
        canVoid: canUpdateVacations && !isDeleted,
        personId: person.id,
        periods: periods.map((period) => ({
          id: period.id,
          fechaIngreso: period.fechaIngreso,
          fechaBaja: period.fechaBaja,
          bajaSinFecha: period.bajaSinFecha,
          reconoceAntiguedad: period.reconoceAntiguedad,
          fechaAntiguedadReconocida: period.fechaAntiguedadReconocida,
        })),
        fallbackFechaIngreso: person.fechaIngreso,
        registerAction: registerVacationAction,
        voidAction: voidVacationAction,
      }
    : undefined;
  const editAction = (
    section: Parameters<typeof personEditHref>[1],
    field?: string,
  ) =>
    canEdit
      ? { label: "Editar", href: personEditHref(person.id, section, field) }
      : null;

  const facts: KeyFact[] = [
    {
      id: "antiguedad",
      label: "Antigüedad",
      // seniorityDate() of the periods, counted to the fecha de baja on baja.
      ...seniorityFact({
        seniorityDate: employmentSummary
          ? employmentSummary.fechaAntiguedad
          : person.fechaIngreso,
        asOf: seniorityAsOf({
          status: person.status,
          fechaBaja: employmentSummary?.fechaBaja ?? null,
          today,
        }),
        fechaIngreso: employmentSummary?.fechaIngreso ?? person.fechaIngreso,
        baja: isBaja,
      }),
    },
    {
      id: "ingreso",
      label: "Ingreso",
      ...ingresoFact({
        fechaIngreso: employmentSummary?.fechaIngreso ?? person.fechaIngreso,
        periodCount: employmentSummary?.periodCount,
        reconoceAntiguedad: employmentSummary?.reconoceAntiguedad,
      }),
    },
    ...(canReadContracts
      ? [
          {
            id: "contrato" as const,
            label: "Contrato vigente",
            ...contractFact(
              vigente
                ? {
                    typeLabel: contractTypeLabels[vigente.type],
                    endDate: vigente.endDate,
                  }
                : null,
              today,
              formatContractDate,
            ),
          },
        ]
      : []),
    {
      id: "jefe",
      label: "Jefe directo",
      value: person.manager
        ? formatPersonName(person.manager)
        : "Sin jefe directo",
      href: person.manager ? `/app/personas/${person.manager.id}` : undefined,
    },
    {
      id: "horario",
      label: "Horario",
      value: horario === "—" ? "Sin horario" : horario,
    },
  ];

  // Contrato lands first on ?emit=1 / ?contract=created (they opened its tab).
  const landOn: DetailCardId | undefined =
    (emit === "1" || contract === "created") && canReadContracts && !isDeleted
      ? "contrato"
      : undefined;

  const cards: DetailCardId[] = [
    ...(isBaja ? (["baja"] as const) : []),
    "identidad",
    "laboral",
    "vacaciones",
    "contacto",
    ...(canReadContracts ? (["contrato"] as const) : []),
    "fiscal",
    "datos-mexico",
    ...(canReadAssets ? (["resguardo"] as const) : []),
    ...(canReadAudit ? (["historial"] as const) : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageBreadcrumbLabel label={personName} />

      <PersonCredential
        facts={facts}
        header={
          <PageHeader
            menu={
              <PersonActionsMenu
                deleteAction={
                  canDelete && !isDeleted
                    ? deletePersonAction.bind(null, person.id)
                    : undefined
                }
                emitContractHref={canEmit ? emitHref : undefined}
                personId={person.id}
                personName={personName}
                showConstancia={canReadContracts}
                showStartAlta={canEdit && person.status === "activa"}
                status={person.status}
                employment={employment}
                finiquitoAction={
                  canEdit
                    ? updateFiniquitoAction.bind(null, person.id)
                    : undefined
                }
                statusAction={statusAction}
              />
            }
            meta={personMeta || undefined}
            primary={
              canEdit
                ? {
                    label: "Editar",
                    icon: PencilIcon,
                    href: `/app/personas/${person.id}?edit=1`,
                  }
                : null
            }
            secondary={
              canEmit
                ? {
                    label: "Emitir contrato",
                    icon: FileSignatureIcon,
                    href: emitHref,
                  }
                : null
            }
            status={
              <>
                <Badge tone={toneFor("person", person.status)}>
                  {personStatusLabels[person.status]}
                </Badge>
                {isDeleted ? (
                  <Badge tone={deletedTone}>{personDeletedLabel}</Badge>
                ) : null}
              </>
            }
            title={personName}
            variant="detail"
          />
        }
        initials={personInitials(person)}
        isDeleted={isDeleted}
        status={person.status}
      />

      <div className="space-y-4 empty:hidden">
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

        {baja === "1" && isBaja ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            role="status"
          >
            Baja registrada. El periodo laboral quedó cerrado.
          </p>
        ) : null}

        {reingreso === "1" && !isBaja ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            role="status"
          >
            Reingreso registrado: se abrió un nuevo periodo laboral.
          </p>
        ) : null}

        {finiquito === "1" ? (
          <p
            className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
            role="status"
          >
            Finiquito actualizado.
          </p>
        ) : null}
      </div>

      <PersonSectionNav
        cards={cards.map((card) => ({ id: card, label: DETAIL_CARDS[card] }))}
        landOn={landOn}
      />

      <div className="workia-detail-grid flex flex-col gap-4">
        <PersonBajaCard
          action={
            isBaja && statusAction && employment ? (
              <PersonRehireButton
                action={statusAction}
                lastBaja={employment.lastBaja}
                personName={personName}
              />
            ) : undefined
          }
          details={
            employmentSummary
              ? bajaDetails(employmentSummary, canSeeCompensation)
              : undefined
          }
          status={person.status}
        />

        {/* Two stacks, not rows: cards keep their own height, and on phones
            the DOM order (left stack, then right) is the reading order. */}
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <DetailCard action={editAction("nombre")} id="identidad">
              <DetailFieldList
                canEdit={canEdit}
                fields={[
                  { label: "Nombre(s)", value: person.nombres },
                  { label: "Apellido paterno", value: person.apellidoPaterno },
                  {
                    label: "Apellido materno",
                    value: person.apellidoMaterno,
                    section: "nombre",
                    field: "apellidoMaterno",
                  },
                  {
                    label: "Fecha de nacimiento",
                    value: person.fechaNacimiento
                      ? formatDateLabel(person.fechaNacimiento)
                      : null,
                    section: "empresa",
                    field: "fechaNacimiento",
                  },
                ]}
                personId={person.id}
              />
            </DetailCard>

            <DetailCard action={editAction("empresa")} id="laboral">
              <DetailFieldList
                canEdit={canEdit}
                fields={[
                  {
                    label: "Fecha de ingreso",
                    value: person.fechaIngreso
                      ? formatDateLabel(person.fechaIngreso)
                      : null,
                    section: "empresa",
                    field: "fechaIngreso",
                  },
                  {
                    label: "Ubicación",
                    value: buildSiteLabel(person.site),
                    section: "empresa",
                    field: "siteId",
                  },
                  {
                    label: "Área",
                    value: person.area?.name,
                    section: "empresa",
                    field: "areaId",
                  },
                  {
                    label: "Puesto",
                    value: person.position?.name,
                    section: "empresa",
                    field: "positionId",
                  },
                  {
                    label: "Jefe directo",
                    value: person.manager
                      ? formatPersonName(person.manager)
                      : null,
                    section: "empresa",
                    field: "managerId",
                    wide: true,
                  },
                  {
                    label: "Horario",
                    value: horario,
                    section: "horario",
                    wide: true,
                    testId: "person-schedule",
                  },
                  // Read-only: the activities come from the puesto's catalog.
                  ...(person.position && positionActivities.length > 0
                    ? [
                        {
                          label: "Actividades del puesto",
                          value: (
                            <ul className="list-disc space-y-1 pl-5">
                              {positionActivities.map((activity) => (
                                <li key={activity.id}>{activity.name}</li>
                              ))}
                            </ul>
                          ),
                          wide: true,
                        },
                      ]
                    : []),
                  // After a rehire: every period, oldest first.
                  ...(periods.length > 1
                    ? [
                        {
                          label: "Periodos laborales",
                          value: (
                            <PersonEmploymentPeriods
                              items={employmentPeriodItems(
                                periods,
                                canSeeCompensation,
                              )}
                            />
                          ),
                          wide: true,
                        },
                      ]
                    : []),
                ]}
                personId={person.id}
              />
            </DetailCard>

            <PersonVacationCard ledger={vacationLedger} view={vacation} />

            <DetailCard
              action={editAction("identificadores", "telefono")}
              id="contacto"
            >
              <DetailFieldList
                canEdit={canEdit}
                fields={[
                  {
                    label: "Teléfono",
                    value: person.telefono,
                    section: "identificadores",
                    field: "telefono",
                  },
                  {
                    label: "Correo",
                    value: person.email,
                    section: "identificadores",
                    field: "email",
                  },
                ]}
                personId={person.id}
              />
            </DetailCard>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {canReadContracts ? (
              <DetailCard
                action={
                  canEmit && !vigente
                    ? { label: "Emitir contrato", href: emitHref }
                    : {
                        label: "Ver constancia",
                        href: `/app/personas/${person.id}/constancia`,
                      }
                }
                id="contrato"
              >
                <PersonContractsSection
                  canCreate={canCreateContracts}
                  canDecide={canUpdateContracts && !isDeleted}
                  personName={personName}
                  positions={renewalPositions}
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
                    horario,
                  }}
                  personId={person.id}
                  showEmitForm={emit === "1" && !isDeleted}
                  showHeading={false}
                  templates={contractTemplates}
                />
              </DetailCard>
            ) : null}

            <DetailCard
              action={editAction("identificadores", "rfc")}
              id="fiscal"
            >
              <DetailFieldList
                canEdit={canEdit}
                fields={[
                  {
                    label: "RFC",
                    value: person.rfc,
                    section: "identificadores",
                    field: "rfc",
                  },
                  {
                    label: "CURP",
                    value: person.curp,
                    section: "identificadores",
                    field: "curp",
                  },
                  {
                    label: "NSS",
                    value: person.nss,
                    section: "identificadores",
                    field: "nss",
                  },
                ]}
                personId={person.id}
              />
            </DetailCard>

            <DetailCard action={editAction("datos-mexico")} id="datos-mexico">
              <DetailFieldList
                canEdit={canEdit}
                fields={[
                  {
                    label: "Domicilio",
                    value: formatMexicanAddress(person),
                    section: "datos-mexico",
                    field: "domicilioCalle",
                    wide: true,
                  },
                  {
                    label: "Estado civil",
                    value: person.estadoCivil
                      ? maritalStatusLabels[person.estadoCivil]
                      : null,
                    section: "datos-mexico",
                    field: "estadoCivil",
                  },
                  {
                    label: "Sexo",
                    value: person.sexo ? sexLabels[person.sexo] : null,
                    section: "datos-mexico",
                    field: "sexo",
                  },
                  {
                    label: "Lugar de nacimiento",
                    value: person.lugarNacimiento,
                    section: "datos-mexico",
                    field: "lugarNacimiento",
                  },
                  {
                    label: "Nacionalidad",
                    value: person.nacionalidad,
                    section: "datos-mexico",
                    field: "nacionalidad",
                  },
                  {
                    label: "Clave de elector (INE)",
                    value: person.ineClaveElector,
                    section: "datos-mexico",
                    field: "ineClaveElector",
                  },
                  {
                    label: "Beneficiarios",
                    value:
                      beneficiaries.length > 0 ? (
                        <ul className="space-y-1">
                          {beneficiaries.map((item) => (
                            <li key={item.id}>
                              {item.nombre} · {item.parentesco} ·{" "}
                              {item.porcentaje.toLocaleString("es-MX")} %
                            </li>
                          ))}
                        </ul>
                      ) : null,
                    section: "beneficiarios",
                    wide: true,
                  },
                ]}
                personId={person.id}
              />
            </DetailCard>
          </div>
        </div>

        {canReadAssets ? (
          <DetailCard
            action={{ label: "Ver todo", href: "/app/resguardo" }}
            description="Activos asignados actualmente a esta persona."
            id="resguardo"
            title="Equipo en resguardo"
          >
            <Suspense fallback={<SectionSkeleton rows={2} />}>
              <PersonAssetsCard
                companyId={session.companyId}
                personId={person.id}
              />
            </Suspense>
          </DetailCard>
        ) : null}

        {canReadAudit ? (
          <DetailCard
            action={{
              label: "Ver todo",
              href: `/app/auditoria?resourceType=person&resourceId=${person.id}`,
            }}
            description="Quién cambió qué en este expediente."
            id="historial"
            title="Historial de cambios"
          >
            <Suspense fallback={<SectionSkeleton rows={3} />}>
              <PersonHistory
                companyId={session.companyId}
                compensation={canSeeCompensation}
                personId={id}
              />
            </Suspense>
          </DetailCard>
        ) : null}
      </div>
    </div>
  );
};

export default PersonaDetailPage;
