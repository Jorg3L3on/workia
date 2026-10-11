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
  or,
  sql,
} from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotPerson,
  snapshotPersonSchedule,
} from "@/lib/audit";
import { db, withTransaction, type DbExecutor } from "@/lib/db";
import { escapeLike } from "@/lib/db/like";
import { personSearchText } from "@/lib/db/schema/people";
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

export type ListPeoplePageOptions = {
  query?: string;
  status?: PersonStatus;
  /** Show only soft-deleted records instead of only live ones. */
  deleted?: boolean;
  page: number;
  pageSize: number;
};

/** One page of the Personas list: only the columns the table shows, plus the total. */
export const listPeoplePage = async (options: ListPeoplePageOptions) => {
  const filters = [
    options.deleted ? isNotNull(people.deletedAt) : isNull(people.deletedAt),
  ];

  if (options.status) {
    filters.push(eq(people.status, options.status));
  }

  // Every word must appear somewhere in name/RFC/CURP/email.
  for (const term of options.query?.trim().split(/\s+/).filter(Boolean) ?? []) {
    filters.push(ilike(personSearchText(people), `%${escapeLike(term)}%`));
  }

  const where = and(...filters);

  const [rows, [totals]] = await Promise.all([
    db
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
    db.select({ total: count() }).from(people).where(where),
  ]);

  return { rows, total: totals?.total ?? 0 };
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

/** Search-as-you-type options for the manager picker: active people only, capped. */
export const searchActivePeopleForSelect = async (
  query: string,
  excludeId?: string,
  limit = 20,
) => {
  const filters = [isNull(people.deletedAt), eq(people.status, "activa")];

  if (excludeId) {
    filters.push(sql`${people.id} <> ${excludeId}`);
  }

  for (const term of query.trim().split(/\s+/).filter(Boolean)) {
    filters.push(ilike(personSearchText(people), `%${escapeLike(term)}%`));
  }

  return db
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
  id: string,
  includeDeleted = false,
  executor: DbExecutor = db,
) => {
  const filters = [eq(people.id, id)];

  if (!includeDeleted) {
    filters.push(isNull(people.deletedAt));
  }

  const [person] = await executor
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
  const manager = alias(people, "manager");

  const [row] = await db
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
      includeDeleted
        ? eq(people.id, id)
        : and(eq(people.id, id), isNull(people.deletedAt)),
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
  personId: string,
  includeDeleted = false,
  executor: DbExecutor = db,
) => {
  const filters = [eq(personSchedules.personId, personId)];

  if (!includeDeleted) {
    filters.push(isNull(personSchedules.deletedAt));
  }

  const [schedule] = await executor
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
  executor: DbExecutor = db,
  /** The schedule row (any state) when the caller already read it; `null` means none exists. */
  prefetched?: { schedule: typeof personSchedules.$inferSelect | null },
) => {
  const audit = (input: Parameters<typeof recordAuditEvent>[0]) =>
    recordAuditEvent(input, executor);
  const values = toPersonScheduleValues(input);
  const hasTimes = personScheduleHasTimes(values);
  const existing = prefetched
    ? prefetched.schedule
    : await getPersonSchedule(personId, true, executor);

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
        deletedAt,
      })
      .where(eq(personSchedules.id, existing.id))
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
      .set({
        entrada: values.entrada,
        salidaComer: values.salidaComer,
        regresoComer: values.regresoComer,
        salida: values.salida,
        deletedAt: null,
      })
      .where(eq(personSchedules.id, existing.id))
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

  const [created] = await executor
    .insert(personSchedules)
    .values({
      personId,
      entrada: values.entrada,
      salidaComer: values.salidaComer,
      regresoComer: values.regresoComer,
      salida: values.salida,
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

export const createPerson = async (
  input: PersonFormValues,
  actorUserId?: string | null,
) => {
  // One transaction: the row, its schedule and the audit events commit together.
  return withTransaction(async (tx) => {
    const audit = (input: Parameters<typeof recordAuditEvent>[0]) =>
      recordAuditEvent(input, tx);

    const values = toPersonValues(input);

    const [created] = await tx.insert(people).values(values).returning();

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

    await upsertPersonSchedule(created.id, input, actorUserId, tx, {
      schedule: null,
    });

    return created;
  });
};

export const updatePerson = async (
  id: string,
  input: PersonFormValues,
  actorUserId?: string | null,
) => {
  // One transaction: the row, its schedule and the audit events commit together.
  return withTransaction(async (tx) => {
    const audit = (input: Parameters<typeof recordAuditEvent>[0]) =>
      recordAuditEvent(input, tx);

    // One round trip for the person and their schedule (any state).
    const [current] = await tx
      .select({ person: people, schedule: personSchedules })
      .from(people)
      .leftJoin(personSchedules, eq(personSchedules.personId, people.id))
      .where(eq(people.id, id))
      .limit(1);
    const existing = current?.person ?? null;

    if (!existing || existing.deletedAt) {
      return null;
    }

    const before = snapshotPerson(existing);
    const values = toPersonValues(input);

    const [updated] = await tx
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

    await audit({
      actorUserId,
      resourceType: "person",
      resourceId: id,
      action,
      payload: { before, after, changes },
    });

    await upsertPersonSchedule(id, input, actorUserId, tx, {
      schedule: current?.schedule?.id ? current.schedule : null,
    });

    return updated;
  });
};

export const softDeletePerson = async (
  id: string,
  actorUserId?: string | null,
) => {
  // One transaction: the row, its schedule and the audit events commit together.
  return withTransaction(async (tx) => {
    const audit = (input: Parameters<typeof recordAuditEvent>[0]) =>
      recordAuditEvent(input, tx);

    const existing = await getPersonById(id, true, tx);

    if (!existing || existing.deletedAt) {
      return null;
    }

    const before = snapshotPerson(existing);
    const deletedAt = new Date();

    const [updated] = await tx
      .update(people)
      .set({ deletedAt })
      .where(eq(people.id, id))
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

    const schedule = await getPersonSchedule(id, false, tx);

    if (schedule) {
      await tx
        .update(personSchedules)
        .set({ deletedAt: deletedAt })
        .where(eq(personSchedules.id, schedule.id));
    }

    return updated;
  });
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
