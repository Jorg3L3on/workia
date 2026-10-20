import { alias } from "drizzle-orm/pg-core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { formatScheduleBlocks, readStoredBlocks } from "./schedule-blocks";

import {
  buildChanges,
  MEXICO_AUDIT_FIELDS,
  recordAuditEvent,
  snapshotPerson,
  snapshotPersonSchedule,
} from "@/lib/audit";
import { tdb, withTransaction, type DbExecutor } from "@/lib/db";
import { escapeLike } from "@/lib/db/like";
import { personSearchText } from "@/lib/db/schema/people";
import {
  areas,
  people,
  personBeneficiaries,
  personSchedules,
  positions,
  sites,
} from "@/lib/db/schema";
import type { PersonStatus } from "@/lib/db/schema/people";
import { CompanyReferenceError, isUniqueViolation } from "@/lib/db/errors";
import { withTenant } from "@/lib/tenant/scope";

import {
  DuplicateIdentityError,
  identifierOrNull,
  normalizeNss,
  type IdentityField,
} from "./identity";
import {
  personScheduleHasTimes,
  toPersonScheduleValues,
  type PersonFormValues,
  type PersonScheduleValues,
} from "./schema";

/** Audit input without the company: the module adds the one it works in. */
type AuditInput = Omit<Parameters<typeof recordAuditEvent>[0], "companyId">;

export type ListPeopleOptions = {
  query?: string;
  status?: PersonStatus;
  includeDeleted?: boolean;
};

export type PersonWithRelations = Awaited<
  ReturnType<typeof getPersonWithRelations>
>;

const normalizeOptional = (value?: string | null) =>
  value?.trim() ? value.trim() : null;

/** Expediente México fields that were sent; absent ones are left as stored. */
const toMexicoValues = (input: PersonFormValues) => {
  const values: Partial<typeof people.$inferInsert> = {};
  const text = (value: string | undefined) =>
    value === undefined ? undefined : normalizeOptional(value);
  const set = <K extends keyof typeof people.$inferInsert>(
    key: K,
    value: (typeof people.$inferInsert)[K] | undefined,
  ) => {
    if (value !== undefined) values[key] = value;
  };

  set("domicilioCalle", text(input.domicilioCalle));
  set("domicilioNumeroExterior", text(input.domicilioNumeroExterior));
  set("domicilioNumeroInterior", text(input.domicilioNumeroInterior));
  set("domicilioColonia", text(input.domicilioColonia));
  set("domicilioMunicipio", text(input.domicilioMunicipio));
  set("domicilioEstado", text(input.domicilioEstado));
  set("domicilioCodigoPostal", text(input.domicilioCodigoPostal));
  set(
    "estadoCivil",
    input.estadoCivil === undefined
      ? undefined
      : ((input.estadoCivil ||
          null) as (typeof people.$inferInsert)["estadoCivil"]),
  );
  set(
    "sexo",
    input.sexo === undefined
      ? undefined
      : ((input.sexo || null) as (typeof people.$inferInsert)["sexo"]),
  );
  set("lugarNacimiento", text(input.lugarNacimiento));
  set("nacionalidad", text(input.nacionalidad));
  set("ineClaveElector", text(input.ineClaveElector));

  return values;
};

/** Replaces the beneficiaries of a person when the input sent a list. */
const replaceBeneficiaries = async (
  companyId: string,
  personId: string,
  input: PersonFormValues,
  tx: DbExecutor,
  audit: (input: AuditInput) => Promise<unknown>,
  actorUserId?: string | null,
) => {
  if (!input.beneficiarios) {
    return;
  }

  const before = await tx
    .select()
    .from(personBeneficiaries)
    .where(
      withTenant(
        personBeneficiaries,
        companyId,
        eq(personBeneficiaries.personId, personId),
      ),
    )
    .orderBy(asc(personBeneficiaries.orden));
  const describe = (
    list: { nombre: string; parentesco: string; porcentaje: string | number }[],
  ) =>
    list.map(
      (item) =>
        `${item.nombre} (${item.parentesco}, ${Number(item.porcentaje)} %)`,
    );
  const next = input.beneficiarios.map((item) => ({
    nombre: item.nombre,
    parentesco: item.parentesco,
    porcentaje: item.porcentaje,
  }));

  if (JSON.stringify(describe(before)) === JSON.stringify(describe(next))) {
    return;
  }

  await tx
    .delete(personBeneficiaries)
    .where(
      withTenant(
        personBeneficiaries,
        companyId,
        eq(personBeneficiaries.personId, personId),
      ),
    );

  if (next.length > 0) {
    await tx.insert(personBeneficiaries).values(
      next.map((item, index) => ({
        companyId,
        personId,
        nombre: item.nombre,
        parentesco: item.parentesco,
        porcentaje: item.porcentaje.toFixed(2),
        orden: index,
      })),
    );
  }

  await audit({
    actorUserId,
    resourceType: "person",
    resourceId: personId,
    action: "update",
    payload: {
      summary: "Beneficiarios actualizados",
      before: { beneficiarios: describe(before) },
      after: { beneficiarios: describe(next) },
    },
  });
};

/** The beneficiaries of a person in the company, in their order. */
export const listPersonBeneficiaries = async (
  companyId: string,
  personId: string,
) =>
  tdb(companyId)
    .select({
      id: personBeneficiaries.id,
      nombre: personBeneficiaries.nombre,
      parentesco: personBeneficiaries.parentesco,
      porcentaje: personBeneficiaries.porcentaje,
    })
    .from(personBeneficiaries)
    .where(
      withTenant(
        personBeneficiaries,
        companyId,
        eq(personBeneficiaries.personId, personId),
      ),
    )
    .orderBy(asc(personBeneficiaries.orden))
    .then((rows) =>
      rows.map((row) => ({ ...row, porcentaje: Number(row.porcentaje) })),
    );

const toPersonValues = (input: PersonFormValues) => ({
  nombres: input.nombres.trim(),
  apellidoPaterno: input.apellidoPaterno.trim(),
  apellidoMaterno: normalizeOptional(input.apellidoMaterno),
  email: normalizeOptional(input.email),
  telefono: normalizeOptional(input.telefono),
  fechaNacimiento: normalizeOptional(input.fechaNacimiento),
  fechaIngreso: normalizeOptional(input.fechaIngreso),
  areaId: normalizeOptional(input.areaId),
  positionId: normalizeOptional(input.positionId),
  managerId: normalizeOptional(input.managerId),
  siteId: normalizeOptional(input.siteId),
  rfc: identifierOrNull(input.rfc),
  curp: identifierOrNull(input.curp),
  nss: normalizeOptional(normalizeNss(input.nss)),
  status: input.status,
  ...toMexicoValues(input),
});

export const listPeople = async (
  companyId: string,
  options: ListPeopleOptions = {},
) => {
  const { query, status, includeDeleted } = options;

  const filters: (SQL | undefined)[] = [eq(people.companyId, companyId)];

  if (!includeDeleted) {
    filters.push(isNull(people.deletedAt));
  }

  if (query?.trim()) {
    const pattern = `%${query.trim()}%`;
    filters.push(
      or(
        ilike(people.nombres, pattern),
        ilike(people.apellidoPaterno, pattern),
        ilike(people.apellidoMaterno, pattern),
        ilike(people.email, pattern),
        ilike(people.rfc, pattern),
        ilike(people.curp, pattern),
      ),
    );
  }

  if (status) {
    filters.push(eq(people.status, status));
  }

  return tdb(companyId)
    .select()
    .from(people)
    .where(and(...filters))
    .orderBy(
      desc(people.updatedAt),
      asc(people.apellidoPaterno),
      asc(people.nombres),
    );
};

export type ListPeoplePageOptions = {
  query?: string;
  status?: PersonStatus;
  /** Show only soft-deleted records instead of only live ones. */
  deleted?: boolean;
  /** Only people whose site belongs to this region (WRK-I5-4). */
  regionId?: string;
  page: number;
  pageSize: number;
};

/**
 * People whose site is in the region, as a filter. Plain SQL on purpose: the
 * RLS-scoped client cannot be nested as a subquery.
 */
export const personInRegion = (companyId: string, regionId: string) =>
  sql`${people.siteId} in (select ${sites.id} from ${sites} where ${sites.companyId} = ${companyId} and ${sites.regionId} = ${regionId})`;

/** One page of the Personas list: only the columns the table shows, plus the total. */
export const listPeoplePage = async (
  companyId: string,
  options: ListPeoplePageOptions,
) => {
  const filters = [
    eq(people.companyId, companyId),
    options.deleted ? isNotNull(people.deletedAt) : isNull(people.deletedAt),
  ];

  if (options.status) {
    filters.push(eq(people.status, options.status));
  }

  if (options.regionId) {
    filters.push(personInRegion(companyId, options.regionId));
  }

  // Every word must appear somewhere in name/RFC/CURP/email.
  for (const term of options.query?.trim().split(/\s+/).filter(Boolean) ?? []) {
    filters.push(ilike(personSearchText(people), `%${escapeLike(term)}%`));
  }

  const where = and(...filters);

  const [rows, [totals]] = await Promise.all([
    tdb(companyId)
      .select({
        id: people.id,
        nombres: people.nombres,
        apellidoPaterno: people.apellidoPaterno,
        apellidoMaterno: people.apellidoMaterno,
        rfc: people.rfc,
        fechaIngreso: people.fechaIngreso,
        status: people.status,
        deletedAt: people.deletedAt,
      })
      .from(people)
      .where(where)
      .orderBy(
        desc(people.updatedAt),
        asc(people.apellidoPaterno),
        asc(people.nombres),
        asc(people.id),
      )
      .limit(options.pageSize)
      .offset((options.page - 1) * options.pageSize),
    tdb(companyId).select({ total: count() }).from(people).where(where),
  ]);

  return { rows, total: totals?.total ?? 0 };
};

export const listActivePeopleForSelect = async (
  companyId: string,
  excludeId?: string,
) => {
  const rows = await tdb(companyId)
    .select({
      id: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        isNull(people.deletedAt),
        eq(people.status, "activa"),
      ),
    )
    .orderBy(asc(people.apellidoPaterno), asc(people.nombres));

  return excludeId ? rows.filter((row) => row.id !== excludeId) : rows;
};

/** Search-as-you-type options for the manager picker: active people only, capped. */
export const searchActivePeopleForSelect = async (
  companyId: string,
  query: string,
  excludeId?: string,
  limit = 20,
) => {
  const filters = [
    eq(people.companyId, companyId),
    isNull(people.deletedAt),
    eq(people.status, "activa"),
  ];

  if (excludeId) {
    filters.push(sql`${people.id} <> ${excludeId}`);
  }

  for (const term of query.trim().split(/\s+/).filter(Boolean)) {
    filters.push(ilike(personSearchText(people), `%${escapeLike(term)}%`));
  }

  return tdb(companyId)
    .select({
      id: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(people)
    .where(and(...filters))
    .orderBy(asc(people.apellidoPaterno), asc(people.nombres))
    .limit(limit);
};

export const getPersonById = async (
  companyId: string,
  id: string,
  includeDeleted = false,
  executor: DbExecutor = tdb(companyId),
) => {
  const filters = [eq(people.companyId, companyId), eq(people.id, id)];

  if (!includeDeleted) {
    filters.push(isNull(people.deletedAt));
  }

  const [person] = await executor
    .select()
    .from(people)
    .where(and(...filters))
    .limit(1);

  return person ?? null;
};

export const getPersonWithRelations = async (
  companyId: string,
  id: string,
  includeDeleted = false,
) => {
  const manager = alias(people, "manager");

  const [row] = await tdb(companyId)
    .select({
      person: people,
      area: { id: areas.id, name: areas.name },
      position: { id: positions.id, name: positions.name },
      manager: {
        id: manager.id,
        nombres: manager.nombres,
        apellidoPaterno: manager.apellidoPaterno,
        apellidoMaterno: manager.apellidoMaterno,
      },
      site: { id: sites.id, name: sites.name, kind: sites.kind },
      schedule: personSchedules,
    })
    .from(people)
    .leftJoin(areas, eq(people.areaId, areas.id))
    .leftJoin(positions, eq(people.positionId, positions.id))
    .leftJoin(manager, eq(people.managerId, manager.id))
    .leftJoin(sites, eq(people.siteId, sites.id))
    .leftJoin(
      personSchedules,
      and(
        eq(personSchedules.personId, people.id),
        isNull(personSchedules.deletedAt),
      ),
    )
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, id),
        includeDeleted ? undefined : isNull(people.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    ...row.person,
    area: row.area?.id ? row.area : null,
    position: row.position?.id ? row.position : null,
    manager: row.manager?.id ? row.manager : null,
    site: row.site?.id ? row.site : null,
    schedule: row.schedule?.id ? row.schedule : null,
  };
};

export const getPersonSchedule = async (
  companyId: string,
  personId: string,
  includeDeleted = false,
  executor: DbExecutor = tdb(companyId),
) => {
  const filters = [
    eq(personSchedules.companyId, companyId),
    eq(personSchedules.personId, personId),
  ];

  if (!includeDeleted) {
    filters.push(isNull(personSchedules.deletedAt));
  }

  const [schedule] = await executor
    .select()
    .from(personSchedules)
    .where(and(...filters))
    .limit(1);

  return schedule ?? null;
};

// jsonb reorders keys: compare blocks by their meaning (the text), not their JSON.
const blocksKey = (blocks: unknown) =>
  Array.isArray(blocks) && blocks.length > 0
    ? formatScheduleBlocks(readStoredBlocks(blocks, null))
    : null;

const scheduleChanged = (
  before: PersonScheduleValues | null,
  after: PersonScheduleValues,
) =>
  (before?.entrada ?? null) !== (after.entrada ?? null) ||
  (before?.salidaComer ?? null) !== (after.salidaComer ?? null) ||
  (before?.regresoComer ?? null) !== (after.regresoComer ?? null) ||
  (before?.salida ?? null) !== (after.salida ?? null) ||
  // A simple-schedule write (no blocks sent) only counts its four fields.
  (after.blocks !== undefined &&
    (blocksKey(before?.blocks) !== blocksKey(after.blocks) ||
      (before?.restDay ?? null) !== (after.restDay ?? null)));

/** Columns to store: blocks as sent, or none when a simple schedule changed. */
const scheduleColumns = (values: PersonScheduleValues) => ({
  entrada: values.entrada ?? null,
  salidaComer: values.salidaComer ?? null,
  regresoComer: values.regresoComer ?? null,
  salida: values.salida ?? null,
  blocks: (blocksKey(values.blocks)
    ? values.blocks
    : null) as (typeof personSchedules.$inferInsert)["blocks"],
  restDay: values.restDay ?? null,
});

export const upsertPersonSchedule = async (
  companyId: string,
  personId: string,
  input: PersonFormValues,
  actorUserId?: string | null,
  executor: DbExecutor = tdb(companyId),
  /** The schedule row (any state) when the caller already read it; `null` means none exists. */
  prefetched?: { schedule: typeof personSchedules.$inferSelect | null },
) => {
  const audit = (input: AuditInput) =>
    recordAuditEvent({ ...input, companyId }, executor);
  const values = toPersonScheduleValues(input);
  const hasTimes = personScheduleHasTimes(values);
  const existing = prefetched
    ? prefetched.schedule
    : await getPersonSchedule(companyId, personId, true, executor);

  if (!hasTimes && !existing) {
    return null;
  }

  if (!hasTimes && existing?.deletedAt) {
    return existing;
  }

  if (!hasTimes && existing) {
    const deletedAt = new Date();
    const [updated] = await executor
      .update(personSchedules)
      .set({
        entrada: null,
        salidaComer: null,
        regresoComer: null,
        salida: null,
        blocks: null,
        restDay: null,
        deletedAt,
      })
      .where(
        withTenant(
          personSchedules,
          companyId,
          eq(personSchedules.id, existing.id),
        ),
      )
      .returning();

    await audit({
      actorUserId,
      resourceType: "person",
      resourceId: personId,
      action: "delete",
      payload: {
        summary: "Borrado de horario",
        before: snapshotPersonSchedule(existing),
        after: snapshotPersonSchedule(updated),
      },
    });

    return updated;
  }

  if (existing && !existing.deletedAt && !scheduleChanged(existing, values)) {
    return existing;
  }

  if (existing) {
    const wasDeleted = Boolean(existing.deletedAt);
    const [updated] = await executor
      .update(personSchedules)
      .set({ ...scheduleColumns(values), deletedAt: null })
      .where(
        withTenant(
          personSchedules,
          companyId,
          eq(personSchedules.id, existing.id),
        ),
      )
      .returning();

    await audit({
      actorUserId,
      resourceType: "person",
      resourceId: personId,
      action: wasDeleted ? "create" : "update",
      payload: {
        summary: wasDeleted ? "Alta de horario" : "Edición de horario",
        before: snapshotPersonSchedule(existing),
        after: snapshotPersonSchedule(updated),
        changes: buildChanges(
          snapshotPersonSchedule(existing) ?? {
            entrada: null,
            salidaComer: null,
            regresoComer: null,
            salida: null,
            bloques: null,
            deletedAt: null,
          },
          snapshotPersonSchedule(updated) ?? {
            entrada: null,
            salidaComer: null,
            regresoComer: null,
            salida: null,
            bloques: null,
            deletedAt: null,
          },
          [
            "entrada",
            "salidaComer",
            "regresoComer",
            "salida",
            "bloques",
            "deletedAt",
          ],
        ),
      },
    });

    return updated;
  }

  const [created] = await executor
    .insert(personSchedules)
    .values({
      companyId,
      personId,
      ...scheduleColumns(values),
    })
    .returning();

  await audit({
    actorUserId,
    resourceType: "person",
    resourceId: personId,
    action: "create",
    payload: {
      summary: "Alta de horario",
      after: snapshotPersonSchedule(created),
    },
  });

  return created;
};

/** Active people of the company (not deleted) that already use this CURP, RFC or NSS. */
export const findIdentityConflicts = async (
  companyId: string,
  input: Pick<PersonFormValues, "curp" | "rfc" | "nss">,
  excludeId?: string,
  client: DbExecutor = tdb(companyId),
): Promise<IdentityField[]> => {
  const curp = identifierOrNull(input.curp);
  const rfc = identifierOrNull(input.rfc);
  const nss = normalizeNss(input.nss) || null;
  const matchers = [
    curp ? eq(people.curp, curp) : undefined,
    rfc ? eq(people.rfc, rfc) : undefined,
    nss ? eq(people.nss, nss) : undefined,
  ].filter((matcher) => matcher !== undefined);

  if (matchers.length === 0) {
    return [];
  }

  const rows = await client
    .select({ curp: people.curp, rfc: people.rfc, nss: people.nss })
    .from(people)
    .where(
      and(
        eq(people.companyId, companyId),
        isNull(people.deletedAt),
        or(...matchers),
        excludeId ? ne(people.id, excludeId) : undefined,
      ),
    );

  const fields = new Set<IdentityField>();

  for (const row of rows) {
    if (curp && row.curp === curp) fields.add("curp");
    if (rfc && row.rfc === rfc) fields.add("rfc");
    if (nss && row.nss === nss) fields.add("nss");
  }

  return [...fields];
};

const assertNoIdentityConflicts = async (
  companyId: string,
  input: Pick<PersonFormValues, "curp" | "rfc" | "nss">,
  excludeId?: string,
  client: DbExecutor = tdb(companyId),
) => {
  const conflicts = await findIdentityConflicts(
    companyId,
    input,
    excludeId,
    client,
  );

  if (conflicts.length > 0) {
    throw new DuplicateIdentityError(conflicts);
  }
};

// A race between the pre-check and the write surfaces as a unique violation
// on the partial indexes; report it like the pre-check does.
const IDENTITY_CONSTRAINTS: Record<string, IdentityField> = {
  people_company_curp_active_unique: "curp",
  people_company_rfc_active_unique: "rfc",
  people_company_nss_active_unique: "nss",
};

const violatedConstraint = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null
    ? ((error as { constraint?: string }).constraint ??
      violatedConstraint((error as { cause?: unknown }).cause))
    : undefined;

const rethrowUniqueViolation = (error: unknown): never => {
  if (isUniqueViolation(error)) {
    const field = IDENTITY_CONSTRAINTS[violatedConstraint(error) ?? ""];
    throw new DuplicateIdentityError(field ? [field] : ["curp", "rfc"]);
  }

  throw error;
};

/**
 * Area, puesto, sucursal and jefe must be live records of the same company.
 * The composite foreign keys refuse the rest anyway; this turns it into a
 * field error instead of a database error.
 */
const assertReferencesInCompany = async (
  companyId: string,
  values: ReturnType<typeof toPersonValues>,
  client: DbExecutor,
) => {
  const checks = [
    { field: "areaId", id: values.areaId, table: areas },
    { field: "positionId", id: values.positionId, table: positions },
    { field: "siteId", id: values.siteId, table: sites },
    { field: "managerId", id: values.managerId, table: people },
  ] as const;

  for (const check of checks) {
    if (!check.id) continue;

    const [found] = await client
      .select({ id: check.table.id })
      .from(check.table)
      .where(
        and(
          eq(check.table.companyId, companyId),
          eq(check.table.id, check.id),
          isNull(check.table.deletedAt),
        ),
      )
      .limit(1);

    if (!found) {
      throw new CompanyReferenceError(check.field);
    }
  }
};

export const createPerson = async (
  companyId: string,
  input: PersonFormValues,
  actorUserId?: string | null,
) => {
  // One transaction: the row, its schedule and the audit events commit together.
  return withTransaction(async (tx) => {
    const audit = (input: AuditInput) =>
      recordAuditEvent({ ...input, companyId }, tx);

    const values = toPersonValues(input);

    await assertNoIdentityConflicts(companyId, input, undefined, tx);
    await assertReferencesInCompany(companyId, values, tx);

    const [created] = await tx
      .insert(people)
      .values({ ...values, companyId })
      .returning()
      .catch(rethrowUniqueViolation);

    await audit({
      actorUserId,
      resourceType: "person",
      resourceId: created.id,
      action: "create",
      payload: {
        after: snapshotPerson(created),
        summary: `Alta de persona: ${created.nombres} ${created.apellidoPaterno}`,
      },
    });

    await upsertPersonSchedule(companyId, created.id, input, actorUserId, tx, {
      schedule: null,
    });
    await replaceBeneficiaries(
      companyId,
      created.id,
      input,
      tx,
      audit,
      actorUserId,
    );

    return created;
  }, companyId);
};

export const updatePerson = async (
  companyId: string,
  id: string,
  input: PersonFormValues,
  actorUserId?: string | null,
) => {
  // One transaction: the row, its schedule and the audit events commit together.
  return withTransaction(async (tx) => {
    const audit = (input: AuditInput) =>
      recordAuditEvent({ ...input, companyId }, tx);

    // One round trip for the person and their schedule (any state).
    const [current] = await tx
      .select({ person: people, schedule: personSchedules })
      .from(people)
      .leftJoin(personSchedules, eq(personSchedules.personId, people.id))
      .where(withTenant(people, companyId, eq(people.id, id)))
      .limit(1);
    const existing = current?.person ?? null;

    if (!existing || existing.deletedAt) {
      return null;
    }

    const before = snapshotPerson(existing);
    const values = toPersonValues(input);

    await assertNoIdentityConflicts(companyId, input, id, tx);
    await assertReferencesInCompany(companyId, values, tx);

    const [updated] = await tx
      .update(people)
      .set(values)
      .where(withTenant(people, companyId, eq(people.id, id)))
      .returning()
      .catch(rethrowUniqueViolation);

    if (!updated) {
      return null;
    }

    const after = snapshotPerson(updated);
    const changes = buildChanges(before, after, [
      "nombres",
      "apellidoPaterno",
      "apellidoMaterno",
      "email",
      "telefono",
      "fechaNacimiento",
      "fechaIngreso",
      "areaId",
      "positionId",
      "managerId",
      "siteId",
      "rfc",
      "curp",
      "nss",
      "status",
      ...MEXICO_AUDIT_FIELDS,
    ]);

    let action: "update" | "baja" | "reactivate" = "update";

    if (existing.status !== updated.status) {
      action = updated.status === "baja" ? "baja" : "reactivate";
    }

    await audit({
      actorUserId,
      resourceType: "person",
      resourceId: id,
      action,
      payload: { before, after, changes },
    });

    await upsertPersonSchedule(companyId, id, input, actorUserId, tx, {
      schedule: current?.schedule?.id ? current.schedule : null,
    });
    await replaceBeneficiaries(companyId, id, input, tx, audit, actorUserId);

    return updated;
  }, companyId);
};

/** Baja laboral or reactivation alone: the rest of the expediente stays as is. */
export const setPersonStatus = async (
  companyId: string,
  id: string,
  status: PersonStatus,
  actorUserId?: string | null,
) => {
  return withTransaction(async (tx) => {
    const existing = await getPersonById(companyId, id, false, tx);

    if (!existing || existing.status === status) {
      return existing;
    }

    const before = snapshotPerson(existing);
    const [updated] = await tx
      .update(people)
      .set({ status })
      .where(withTenant(people, companyId, eq(people.id, id)))
      .returning();

    if (!updated) {
      return null;
    }

    const after = snapshotPerson(updated);

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "person",
        resourceId: id,
        action: status === "baja" ? "baja" : "reactivate",
        payload: {
          before,
          after,
          changes: buildChanges(before, after, ["status"]),
        },
      },
      tx,
    );

    return updated;
  }, companyId);
};

export const softDeletePerson = async (
  companyId: string,
  id: string,
  actorUserId?: string | null,
) => {
  // One transaction: the row, its schedule and the audit events commit together.
  return withTransaction(async (tx) => {
    const audit = (input: AuditInput) =>
      recordAuditEvent({ ...input, companyId }, tx);

    const existing = await getPersonById(companyId, id, true, tx);

    if (!existing || existing.deletedAt) {
      return null;
    }

    const before = snapshotPerson(existing);
    const deletedAt = new Date();

    const [updated] = await tx
      .update(people)
      .set({ deletedAt })
      .where(withTenant(people, companyId, eq(people.id, id)))
      .returning();

    if (!updated) {
      return null;
    }

    await audit({
      actorUserId,
      resourceType: "person",
      resourceId: id,
      action: "delete",
      payload: {
        before,
        after: snapshotPerson(updated),
        summary: "Borrado lógico del expediente",
      },
    });

    const schedule = await getPersonSchedule(companyId, id, false, tx);

    if (schedule) {
      await tx
        .update(personSchedules)
        .set({ deletedAt: deletedAt })
        .where(
          withTenant(
            personSchedules,
            companyId,
            eq(personSchedules.id, schedule.id),
          ),
        );
    }

    return updated;
  }, companyId);
};

export const countPeopleByStatus = async (companyId: string) => {
  const rows = await tdb(companyId)
    .select({
      status: people.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(people)
    .where(withTenant(people, companyId, isNull(people.deletedAt)))
    .groupBy(people.status);

  return rows.reduce<Record<PersonStatus, number>>(
    (accumulator, row) => {
      accumulator[row.status] = row.count;
      return accumulator;
    },
    { activa: 0, baja: 0 },
  );
};

export const countActivePeople = async (companyId: string) => {
  const counts = await countPeopleByStatus(companyId);
  return counts.activa;
};

/** Fields `list_people` can ask to be missing (D-14): presence only, never the value. */
export const PERSON_MISSING_FIELDS = [
  "horario",
  "rfc",
  "curp",
  "nss",
  "email",
  "telefono",
  "sucursal",
  "puesto",
] as const;

export type PersonMissingField = (typeof PERSON_MISSING_FIELDS)[number];

export type ListPeopleKeysetOptions = {
  query?: string;
  /** Search RFC and CURP too. Off without the pii scope (no PII oracle). */
  searchIdentifiers?: boolean;
  status?: PersonStatus;
  visibility?: "expediente" | "deleted" | "todos";
  areaId?: string;
  positionId?: string;
  siteId?: string;
  /** Only people whose site is in this region (WRK-I1-15). */
  regionId?: string;
  missing?: PersonMissingField[];
  /** Keyset position: after (apellido_paterno, id). */
  after?: { key: string; id: string } | null;
  limit: number;
};

const hasScheduleTimes = sql`exists (select 1 from ${personSchedules} ps where ps.person_id = ${people.id} and ps.company_id = ${people.companyId} and ps.deleted_at is null and coalesce(ps.entrada, ps.salida_comer, ps.regreso_comer, ps.salida) is not null)`;

const missingFilter = (field: PersonMissingField): SQL => {
  switch (field) {
    case "horario":
      return sql`not ${hasScheduleTimes}`;
    case "rfc":
      return sql`coalesce(${people.rfc}, '') = ''`;
    case "curp":
      return sql`coalesce(${people.curp}, '') = ''`;
    case "nss":
      return sql`coalesce(${people.nss}, '') = ''`;
    case "email":
      return sql`coalesce(${people.email}, '') = ''`;
    case "telefono":
      return sql`coalesce(${people.telefono}, '') = ''`;
    case "sucursal":
      return isNull(people.siteId);
    case "puesto":
      return isNull(people.positionId);
  }
};

/**
 * People in a stable order (apellido paterno, id) for cursor paging, with
 * area, position and site names. Read only; used by the MCP list_people.
 */
export const listPeopleKeyset = async (
  companyId: string,
  options: ListPeopleKeysetOptions,
) => {
  const filters: (SQL | undefined)[] = [eq(people.companyId, companyId)];
  const visibility = options.visibility ?? "expediente";

  if (visibility === "expediente") filters.push(isNull(people.deletedAt));
  if (visibility === "deleted") filters.push(isNotNull(people.deletedAt));
  if (options.status) filters.push(eq(people.status, options.status));
  if (options.areaId) filters.push(eq(people.areaId, options.areaId));
  if (options.positionId)
    filters.push(eq(people.positionId, options.positionId));
  if (options.siteId) filters.push(eq(people.siteId, options.siteId));
  if (options.regionId)
    filters.push(personInRegion(companyId, options.regionId));

  for (const field of options.missing ?? []) {
    filters.push(missingFilter(field));
  }

  const searchable = options.searchIdentifiers
    ? personSearchText(people)
    : sql`(${people.nombres} || ' ' || ${people.apellidoPaterno} || ' ' || coalesce(${people.apellidoMaterno}, '') || ' ' || coalesce(${people.email}, ''))`;

  for (const term of options.query?.trim().split(/\s+/).filter(Boolean) ?? []) {
    filters.push(ilike(searchable, `%${escapeLike(term)}%`));
  }

  if (options.after) {
    filters.push(
      sql`(${people.apellidoPaterno}, ${people.id}) > (${options.after.key}, ${options.after.id}::uuid)`,
    );
  }

  return tdb(companyId)
    .select({
      id: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      status: people.status,
      deletedAt: people.deletedAt,
      fechaIngreso: people.fechaIngreso,
      area: { id: areas.id, name: areas.name },
      position: { id: positions.id, name: positions.name },
      site: { id: sites.id, name: sites.name, kind: sites.kind },
    })
    .from(people)
    .leftJoin(areas, eq(people.areaId, areas.id))
    .leftJoin(positions, eq(people.positionId, positions.id))
    .leftJoin(sites, eq(people.siteId, sites.id))
    .where(and(...filters))
    .orderBy(asc(people.apellidoPaterno), asc(people.id))
    .limit(options.limit + 1);
};

/** Active people (not Borrados) holding a position, for impact warnings. */
export const countActivePeopleInPosition = async (
  companyId: string,
  positionId: string,
) => {
  const [row] = await tdb(companyId)
    .select({ total: count() })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        eq(people.positionId, positionId),
        eq(people.status, "activa"),
        isNull(people.deletedAt),
      ),
    );

  return row?.total ?? 0;
};
