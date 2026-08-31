import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotPerson,
  snapshotPersonSchedule,
} from "@/lib/audit";
import { db } from "@/lib/db";
import {
  areas,
  people,
  personSchedules,
  positions,
  sites,
} from "@/lib/db/schema";
import type { PersonStatus } from "@/lib/db/schema/people";

import {
  personScheduleHasTimes,
  toPersonScheduleValues,
  type PersonFormValues,
  type PersonScheduleValues,
} from "./schema";

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
  rfc: normalizeOptional(input.rfc),
  curp: normalizeOptional(input.curp),
  nss: normalizeOptional(input.nss),
  status: input.status,
});

export const listPeople = async (options: ListPeopleOptions = {}) => {
  const { query, status, includeDeleted } = options;

  const filters = [];

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

  const whereClause =
    filters.length === 0
      ? undefined
      : filters.length === 1
        ? filters[0]
        : and(...filters);

  return db
    .select()
    .from(people)
    .where(whereClause)
    .orderBy(
      desc(people.updatedAt),
      asc(people.apellidoPaterno),
      asc(people.nombres),
    );
};

export const listActivePeopleForSelect = async (excludeId?: string) => {
  const rows = await db
    .select({
      id: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(people)
    .where(and(isNull(people.deletedAt), eq(people.status, "activa")))
    .orderBy(asc(people.apellidoPaterno), asc(people.nombres));

  return excludeId ? rows.filter((row) => row.id !== excludeId) : rows;
};

export const getPersonById = async (id: string, includeDeleted = false) => {
  const filters = [eq(people.id, id)];

  if (!includeDeleted) {
    filters.push(isNull(people.deletedAt));
  }

  const [person] = await db
    .select()
    .from(people)
    .where(filters.length === 1 ? filters[0] : and(...filters))
    .limit(1);

  return person ?? null;
};

export const getPersonWithRelations = async (
  id: string,
  includeDeleted = false,
) => {
  const person = await getPersonById(id, includeDeleted);

  if (!person) {
    return null;
  }

  const [area, position, manager, site] = await Promise.all([
    person.areaId
      ? db
          .select({ id: areas.id, name: areas.name })
          .from(areas)
          .where(eq(areas.id, person.areaId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    person.positionId
      ? db
          .select({ id: positions.id, name: positions.name })
          .from(positions)
          .where(eq(positions.id, person.positionId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    person.managerId
      ? db
          .select({
            id: people.id,
            nombres: people.nombres,
            apellidoPaterno: people.apellidoPaterno,
            apellidoMaterno: people.apellidoMaterno,
          })
          .from(people)
          .where(eq(people.id, person.managerId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    person.siteId
      ? db
          .select({ id: sites.id, name: sites.name, kind: sites.kind })
          .from(sites)
          .where(eq(sites.id, person.siteId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const schedule = await getPersonSchedule(person.id);

  return { ...person, area, position, manager, site, schedule };
};

export const getPersonSchedule = async (
  personId: string,
  includeDeleted = false,
) => {
  const filters = [eq(personSchedules.personId, personId)];

  if (!includeDeleted) {
    filters.push(isNull(personSchedules.deletedAt));
  }

  const [schedule] = await db
    .select()
    .from(personSchedules)
    .where(filters.length === 1 ? filters[0] : and(...filters))
    .limit(1);

  return schedule ?? null;
};

const scheduleChanged = (
  before: PersonScheduleValues | null,
  after: PersonScheduleValues,
) =>
  (before?.entrada ?? null) !== (after.entrada ?? null) ||
  (before?.salidaComer ?? null) !== (after.salidaComer ?? null) ||
  (before?.regresoComer ?? null) !== (after.regresoComer ?? null) ||
  (before?.salida ?? null) !== (after.salida ?? null);

export const upsertPersonSchedule = async (
  personId: string,
  input: PersonFormValues,
  actorUserId?: string | null,
) => {
  const values = toPersonScheduleValues(input);
  const hasTimes = personScheduleHasTimes(values);
  const existing = await getPersonSchedule(personId, true);

  if (!hasTimes && !existing) {
    return null;
  }

  if (!hasTimes && existing?.deletedAt) {
    return existing;
  }

  if (!hasTimes && existing) {
    const deletedAt = new Date();
    const [updated] = await db
      .update(personSchedules)
      .set({
        entrada: null,
        salidaComer: null,
        regresoComer: null,
        salida: null,
        deletedAt,
      })
      .where(eq(personSchedules.id, existing.id))
      .returning();

    await recordAuditEvent({
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
    const [updated] = await db
      .update(personSchedules)
      .set({
        entrada: values.entrada,
        salidaComer: values.salidaComer,
        regresoComer: values.regresoComer,
        salida: values.salida,
        deletedAt: null,
      })
      .where(eq(personSchedules.id, existing.id))
      .returning();

    await recordAuditEvent({
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
            deletedAt: null,
          },
          snapshotPersonSchedule(updated) ?? {
            entrada: null,
            salidaComer: null,
            regresoComer: null,
            salida: null,
            deletedAt: null,
          },
          ["entrada", "salidaComer", "regresoComer", "salida", "deletedAt"],
        ),
      },
    });

    return updated;
  }

  const [created] = await db
    .insert(personSchedules)
    .values({
      personId,
      entrada: values.entrada,
      salidaComer: values.salidaComer,
      regresoComer: values.regresoComer,
      salida: values.salida,
    })
    .returning();

  await recordAuditEvent({
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

export const createPerson = async (
  input: PersonFormValues,
  actorUserId?: string | null,
) => {
  const values = toPersonValues(input);

  const [created] = await db.insert(people).values(values).returning();

  await recordAuditEvent({
    actorUserId,
    resourceType: "person",
    resourceId: created.id,
    action: "create",
    payload: {
      after: snapshotPerson(created),
      summary: `Alta de persona: ${created.nombres} ${created.apellidoPaterno}`,
    },
  });

  await upsertPersonSchedule(created.id, input, actorUserId);

  return created;
};

export const updatePerson = async (
  id: string,
  input: PersonFormValues,
  actorUserId?: string | null,
) => {
  const existing = await getPersonById(id, true);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotPerson(existing);
  const values = toPersonValues(input);

  const [updated] = await db
    .update(people)
    .set(values)
    .where(eq(people.id, id))
    .returning();

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
  ]);

  let action: "update" | "baja" | "reactivate" = "update";

  if (existing.status !== updated.status) {
    action = updated.status === "baja" ? "baja" : "reactivate";
  }

  await recordAuditEvent({
    actorUserId,
    resourceType: "person",
    resourceId: id,
    action,
    payload: { before, after, changes },
  });

  await upsertPersonSchedule(id, input, actorUserId);

  return updated;
};

export const softDeletePerson = async (
  id: string,
  actorUserId?: string | null,
) => {
  const existing = await getPersonById(id, true);

  if (!existing || existing.deletedAt) {
    return null;
  }

  const before = snapshotPerson(existing);
  const deletedAt = new Date();

  const [updated] = await db
    .update(people)
    .set({ deletedAt })
    .where(eq(people.id, id))
    .returning();

  if (!updated) {
    return null;
  }

  await recordAuditEvent({
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

  const schedule = await getPersonSchedule(id);

  if (schedule) {
    await db
      .update(personSchedules)
      .set({ deletedAt: deletedAt })
      .where(eq(personSchedules.id, schedule.id));
  }

  return updated;
};

export const countPeopleByStatus = async () => {
  const rows = await db
    .select({
      status: people.status,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(people)
    .where(isNull(people.deletedAt))
    .groupBy(people.status);

  return rows.reduce<Record<PersonStatus, number>>(
    (accumulator, row) => {
      accumulator[row.status] = row.count;
      return accumulator;
    },
    { activa: 0, baja: 0 },
  );
};

export const countActivePeople = async () => {
  const counts = await countPeopleByStatus();
  return counts.activa;
};
