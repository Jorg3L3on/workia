import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { recordAuditEvent, snapshotPerson } from "@/lib/audit";
import { db, withTransaction, type DbTransaction } from "@/lib/db";
import {
  areas,
  auditEvents,
  importJobs,
  importRows,
  people,
  personSchedules,
  positions,
  sites,
  type ImportJob,
  type ImportJobCounts,
} from "@/lib/db/schema";

import { catalogKey } from "./format";
import { classifyPersonRow } from "./person-rows";
import type { ManagerRef, NormalizedPerson } from "./types";
import { loadLookups, restartValidation, validateJobStep } from "./validate";

export const APPLY_BATCH_SIZE = 200;

/** Phases run in this order; each is resumable because rows carry their mark. */
export type ApplyPhase = "personas" | "managers" | "horarios" | "done";

export class ImportBlockedError extends Error {
  constructor(
    message: string,
    public readonly code:
      "another_import_running" | "has_errors" | "not_applicable" | "changed",
  ) {
    super(message);
    this.name = "ImportBlockedError";
  }
}

export type ApplyProgress = {
  phase: ApplyPhase;
  done: boolean;
  applied: number;
  remaining: number;
};

type StagedRow = {
  id: string;
  sheet: string;
  rowNumber: number;
  action: "create" | "update";
  normalized: NormalizedPerson & { times?: Record<string, string | null> };
  diff: Record<string, [unknown, unknown]> | null;
  targetPersonId: string | null;
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  ((error as { code?: string }).code === "23505" ||
    isUniqueViolation((error as { cause?: unknown }).cause));

const lockJob = (tx: DbTransaction, jobId: string) =>
  // Serializes concurrent apply steps of the same job (two open tabs).
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${jobId}, 0))`);

const PERSON_FIELDS = [
  "nombres",
  "apellidoPaterno",
  "apellidoMaterno",
  "email",
  "telefono",
  "fechaNacimiento",
  "fechaIngreso",
  "areaId",
  "positionId",
  "siteId",
  "rfc",
  "curp",
  "nss",
  "status",
] as const;

/** Moves the job to `applying`; at most one job can be applying at a time. */
const beginApply = async (job: ImportJob) => {
  if (job.status === "applying") {
    return job;
  }

  if (!["in_review", "failed"].includes(job.status)) {
    throw new ImportBlockedError(
      "Esta importación no se puede aplicar.",
      "not_applicable",
    );
  }

  if (job.options.mode === "all_or_nothing" && job.status === "in_review") {
    // Validate again from scratch: nothing is applied unless it is all valid.
    await restartValidation(job.id, {});
    let step;

    do {
      step = await validateJobStep(job.id);
    } while (!step.done);

    const errors = step.counts?.error ?? 0;

    if (errors > 0) {
      throw new ImportBlockedError(
        `Hay ${errors} filas con errores; corrígelas o aplica solo las válidas.`,
        "has_errors",
      );
    }
  }

  try {
    const [updated] = await db
      .update(importJobs)
      .set({ status: "applying", failureMessage: null })
      .where(
        and(
          eq(importJobs.id, job.id),
          inArray(importJobs.status, ["in_review", "failed"]),
        ),
      )
      .returning();

    return updated ?? job;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ImportBlockedError(
        "Hay otra importación aplicándose. Termínala o páusala primero.",
        "another_import_running",
      );
    }

    throw error;
  }
};

/** Creates catalog entries named in the batch that do not exist yet. */
const ensureCatalogs = async (
  tx: DbTransaction,
  rows: StagedRow[],
  actorUserId: string | null,
) => {
  const needed = rows.filter(
    (row) => Object.keys(row.normalized.missingCatalogs).length > 0,
  );
  const created = {
    areas: new Map<string, string>(),
    positions: new Map<string, string>(),
    sites: new Map<string, string>(),
  };

  if (needed.length === 0) {
    return created;
  }

  // Sequential: a transaction owns one connection, which runs one query at a time.
  const areaRows = await tx
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(isNull(areas.deletedAt));
  const positionRows = await tx
    .select({ id: positions.id, name: positions.name })
    .from(positions)
    .where(isNull(positions.deletedAt));
  const siteRows = await tx
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(isNull(sites.deletedAt));
  const areaByKey = new Map(areaRows.map((a) => [catalogKey(a.name), a.id]));
  const siteByKey = new Map(siteRows.map((s) => [catalogKey(s.name), s.id]));
  const positionByKey = new Map(
    positionRows.map((p) => [catalogKey(p.name), p.id]),
  );
  const audit: (typeof auditEvents.$inferInsert)[] = [];
  const event = (
    resourceType: "area" | "position" | "site",
    id: string,
    name: string,
  ) =>
    audit.push({
      actorUserId,
      resourceType,
      resourceId: id,
      action: "create",
      source: "import",
      payload: { summary: `Alta desde importación: ${name}`, after: { name } },
    });

  for (const row of needed) {
    const missing = row.normalized.missingCatalogs;
    let areaId = row.normalized.values.areaId;

    if (missing.area) {
      const key = catalogKey(missing.area);
      let id = areaByKey.get(key);

      if (!id) {
        [{ id }] = await tx
          .insert(areas)
          .values({ name: missing.area })
          .returning({ id: areas.id });
        areaByKey.set(key, id);
        event("area", id, missing.area);
      }

      created.areas.set(key, id);
      areaId = id;
    }

    if (missing.position) {
      const key = catalogKey(missing.position);
      let id = positionByKey.get(key);

      if (!id) {
        [{ id }] = await tx
          .insert(positions)
          .values({ name: missing.position, areaId })
          .returning({ id: positions.id });
        positionByKey.set(key, id);
        event("position", id, missing.position);
      }

      created.positions.set(key, id);
    }

    if (missing.site) {
      const key = catalogKey(missing.site);
      let id = siteByKey.get(key);

      if (!id) {
        [{ id }] = await tx
          .insert(sites)
          .values({ name: missing.site, kind: "sucursal" })
          .returning({ id: sites.id });
        siteByKey.set(key, id);
        event("site", id, missing.site);
      }

      created.sites.set(key, id);
    }
  }

  if (audit.length > 0) {
    await tx.insert(auditEvents).values(audit);
  }

  return created;
};

const personRowsToApply = async (
  tx: DbTransaction,
  jobId: string,
  sheet: "personas" | "horarios",
  limit: number,
) =>
  (await tx
    .select({
      id: importRows.id,
      sheet: importRows.sheet,
      rowNumber: importRows.rowNumber,
      action: importRows.action,
      normalized: importRows.normalized,
      diff: importRows.diff,
      targetPersonId: importRows.targetPersonId,
    })
    .from(importRows)
    .where(
      and(
        eq(importRows.jobId, jobId),
        eq(importRows.sheet, sheet),
        inArray(importRows.action, ["create", "update"]),
        isNull(importRows.appliedAt),
      ),
    )
    .orderBy(asc(importRows.rowNumber))
    .limit(limit)) as unknown as StagedRow[];

const markRows = (
  tx: DbTransaction,
  marks: { id: string; targetPersonId: string | null; previous: unknown }[],
) =>
  tx.execute(sql`
    update import_rows r set
      applied_at = now(),
      target_person_id = v.target_person_id,
      previous_snapshot = nullif(v.previous, 'null'::jsonb)
    from jsonb_to_recordset(${JSON.stringify(
      marks.map((mark) => ({
        id: mark.id,
        target_person_id: mark.targetPersonId,
        previous: mark.previous ?? null,
      })),
    )}::jsonb) as v(id uuid, target_person_id uuid, previous jsonb)
    where r.id = v.id
  `);

const failRows = (tx: DbTransaction, ids: string[], message: string) =>
  tx
    .update(importRows)
    .set({ action: "error", errors: [{ message }] })
    .where(inArray(importRows.id, ids));

/** One transaction: ≤ APPLY_BATCH_SIZE people created or updated, audited, marked. */
const applyPersonasBatch = async (job: ImportJob) =>
  withTransaction(async (tx) => {
    await lockJob(tx, job.id);

    const rows = await personRowsToApply(
      tx,
      job.id,
      "personas",
      APPLY_BATCH_SIZE,
    );

    if (rows.length === 0) {
      return 0;
    }

    // The database may have changed since the review: classify again.
    const lookups = await loadLookups(
      rows.map((row) => ({
        rowNumber: row.rowNumber,
        idWorkia: row.normalized.idWorkia,
        curp: row.normalized.values.curp,
        rfc: row.normalized.values.rfc,
      })),
      tx,
    );
    const stale: string[] = [];
    const ready: StagedRow[] = [];

    for (const row of rows) {
      const fresh = classifyPersonRow(row.normalized, lookups);

      if (
        fresh.action !== row.action ||
        fresh.targetPersonId !== row.targetPersonId
      ) {
        stale.push(row.id);
      } else {
        ready.push(row);
      }
    }

    if (stale.length > 0) {
      if (job.options.mode === "all_or_nothing") {
        throw new ImportBlockedError(
          "Los datos cambiaron desde la revisión; vuelve a revisar la importación.",
          "changed",
        );
      }

      await failRows(
        tx,
        stale,
        "Los datos cambiaron desde la revisión; vuelve a importar esta fila.",
      );
    }

    if (ready.length === 0) {
      return stale.length;
    }

    const catalogs = await ensureCatalogs(tx, ready, job.actorUserId);
    const resolve = (row: StagedRow) => {
      const values = { ...row.normalized.values };
      const missing = row.normalized.missingCatalogs;

      if (missing.area)
        values.areaId =
          catalogs.areas.get(catalogKey(missing.area)) ?? values.areaId;
      if (missing.position)
        values.positionId =
          catalogs.positions.get(catalogKey(missing.position)) ??
          values.positionId;
      if (missing.site)
        values.siteId =
          catalogs.sites.get(catalogKey(missing.site)) ?? values.siteId;

      return values;
    };

    const creates = ready.filter((row) => row.action === "create");
    const updates = ready.filter((row) => row.action === "update");
    const marks: {
      id: string;
      targetPersonId: string | null;
      previous: unknown;
    }[] = [];
    const audit: (typeof auditEvents.$inferInsert)[] = [];

    if (creates.length > 0) {
      const inserted = creates.map((row) => ({
        row,
        id: randomUUID(),
        values: resolve(row),
      }));

      await tx.insert(people).values(
        inserted.map(({ id, values }) => ({
          id,
          ...values,
          status: values.status ?? "activa",
        })),
      );

      for (const { row, id, values } of inserted) {
        marks.push({ id: row.id, targetPersonId: id, previous: null });
        audit.push({
          actorUserId: job.actorUserId,
          resourceType: "person",
          resourceId: id,
          action: "create",
          source: "import",
          payload: {
            summary: `Alta por importación: ${values.nombres} ${values.apellidoPaterno}`,
            after: snapshotPerson({
              ...values,
              status: values.status ?? "activa",
            }),
          },
        });
      }
    }

    if (updates.length > 0) {
      const ids = updates.map((row) => row.targetPersonId!);
      const current = await tx
        .select()
        .from(people)
        .where(and(inArray(people.id, ids), isNull(people.deletedAt)))
        .for("update");
      const byId = new Map(current.map((person) => [person.id, person]));
      const live = updates.filter((row) => byId.has(row.targetPersonId!));
      const gone = updates.filter((row) => !byId.has(row.targetPersonId!));

      if (gone.length > 0) {
        await failRows(
          tx,
          gone.map((row) => row.id),
          "La persona fue borrada desde la revisión.",
        );
      }

      if (live.length > 0) {
        await tx.execute(sql`
          update people p set
            nombres = coalesce(v.nombres, p.nombres),
            apellido_paterno = coalesce(v.apellido_paterno, p.apellido_paterno),
            apellido_materno = coalesce(v.apellido_materno, p.apellido_materno),
            email = coalesce(v.email, p.email),
            telefono = coalesce(v.telefono, p.telefono),
            fecha_nacimiento = coalesce(v.fecha_nacimiento::date, p.fecha_nacimiento),
            fecha_ingreso = coalesce(v.fecha_ingreso::date, p.fecha_ingreso),
            area_id = coalesce(v.area_id::uuid, p.area_id),
            position_id = coalesce(v.position_id::uuid, p.position_id),
            site_id = coalesce(v.site_id::uuid, p.site_id),
            rfc = coalesce(v.rfc, p.rfc),
            curp = coalesce(v.curp, p.curp),
            nss = coalesce(v.nss, p.nss),
            status = coalesce(v.status::person_status, p.status),
            updated_at = now()
          from jsonb_to_recordset(${JSON.stringify(
            live.map((row) => {
              const values = resolve(row);

              return {
                id: row.targetPersonId,
                nombres: values.nombres,
                apellido_paterno: values.apellidoPaterno,
                apellido_materno: values.apellidoMaterno,
                email: values.email,
                telefono: values.telefono,
                fecha_nacimiento: values.fechaNacimiento,
                fecha_ingreso: values.fechaIngreso,
                area_id: values.areaId,
                position_id: values.positionId,
                site_id: values.siteId,
                rfc: values.rfc,
                curp: values.curp,
                nss: values.nss,
                status: values.status,
              };
            }),
          )}::jsonb) as v(
            id uuid, nombres text, apellido_paterno text, apellido_materno text,
            email text, telefono text, fecha_nacimiento text, fecha_ingreso text,
            area_id text, position_id text, site_id text, rfc text, curp text,
            nss text, status text
          )
          where p.id = v.id
        `);

        for (const row of live) {
          const before = byId.get(row.targetPersonId!)!;
          const previous = Object.fromEntries(
            [...PERSON_FIELDS, "managerId" as const].map((field) => [
              field,
              before[field],
            ]),
          );
          const changes = Object.fromEntries(
            Object.entries(row.diff ?? {})
              .filter(
                ([field]) => field !== "managerId" && !field.endsWith("Name"),
              )
              .map(([field, [from, to]]) => [field, { from, to }]),
          );

          marks.push({
            id: row.id,
            targetPersonId: row.targetPersonId,
            previous,
          });
          audit.push({
            actorUserId: job.actorUserId,
            resourceType: "person",
            resourceId: row.targetPersonId!,
            action: "update",
            source: "import",
            payload: {
              summary: `Actualización por importación: ${before.nombres} ${before.apellidoPaterno}`,
              changes,
            },
          });
        }
      }
    }

    if (marks.length > 0) {
      await markRows(tx, marks);
    }

    if (audit.length > 0) {
      await tx.insert(auditEvents).values(audit);
    }

    await tx
      .update(importJobs)
      .set({
        counts: sql`jsonb_set(${importJobs.counts}, '{applied}', to_jsonb(coalesce((${importJobs.counts}->>'applied')::int, 0) + ${marks.length}))`,
      })
      .where(eq(importJobs.id, job.id));

    return rows.length;
  });

const MANAGER_BATCH = 1000;

/** Sets manager links once every person of the file exists. Idempotent. */
const applyManagers = async (job: ImportJob) =>
  withTransaction(async (tx) => {
    await lockJob(tx, job.id);

    const rows = (await tx
      .select({
        rowNumber: importRows.rowNumber,
        normalized: importRows.normalized,
        targetPersonId: importRows.targetPersonId,
        previous: importRows.previousSnapshot,
        id: importRows.id,
      })
      .from(importRows)
      .where(
        and(
          eq(importRows.jobId, job.id),
          eq(importRows.sheet, "personas"),
          isNotNull(importRows.appliedAt),
        ),
      )) as unknown as {
      rowNumber: number;
      normalized: NormalizedPerson | null;
      targetPersonId: string | null;
      previous: Record<string, unknown> | null;
      id: string;
    }[];

    const targetByRow = new Map(
      rows.map((row) => [row.rowNumber, row.targetPersonId]),
    );
    const links = rows.flatMap((row) => {
      const ref: ManagerRef | null | undefined = row.normalized?.managerRef;

      if (!ref || !row.targetPersonId) return [];

      const managerId =
        ref.type === "person" ? ref.id : targetByRow.get(ref.rowNumber);

      return managerId
        ? [{ id: row.targetPersonId, manager_id: managerId }]
        : [];
    });

    for (let start = 0; start < links.length; start += MANAGER_BATCH) {
      await tx.execute(sql`
        update people p set manager_id = v.manager_id, updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(links.slice(start, start + MANAGER_BATCH))}::jsonb)
          as v(id uuid, manager_id uuid)
        where p.id = v.id and p.manager_id is distinct from v.manager_id
      `);
    }

    await tx
      .update(importJobs)
      .set({
        counts: sql`${importJobs.counts} || '{"managersApplied": true}'::jsonb`,
      })
      .where(eq(importJobs.id, job.id));

    return links.length;
  });

/** Schedules: upsert per person, remembering the previous one for undo. */
const applyHorariosBatch = async (job: ImportJob) =>
  withTransaction(async (tx) => {
    await lockJob(tx, job.id);

    const rows = await personRowsToApply(
      tx,
      job.id,
      "horarios",
      APPLY_BATCH_SIZE,
    );

    if (rows.length === 0) {
      return 0;
    }

    const raw = await tx
      .select({ id: importRows.id, raw: importRows.raw })
      .from(importRows)
      .where(
        inArray(
          importRows.id,
          rows.map((row) => row.id),
        ),
      );
    const rawById = new Map(raw.map((row) => [row.id, row.raw]));
    const keys = rows.map((row) => {
      const cells = rawById.get(row.id) ?? {};
      const str = (value: unknown) =>
        typeof value === "string" && value.trim() ? value.trim() : null;

      return {
        rowNumber: row.rowNumber,
        idWorkia: str(cells.idWorkia),
        curp: str(cells.curp)?.replace(/\s+/g, "").toUpperCase() ?? null,
        rfc: null,
      };
    });
    const lookups = await loadLookups(keys, tx);
    const resolved: { row: StagedRow; personId: string }[] = [];
    const unresolved: string[] = [];

    rows.forEach((row, index) => {
      const key = keys[index];
      const person =
        (key.idWorkia
          ? lookups.byId.get(key.idWorkia.toLowerCase())
          : undefined) ?? (key.curp ? lookups.byCurp.get(key.curp) : undefined);

      if (person && !person.deletedAt)
        resolved.push({ row, personId: person.id });
      else unresolved.push(row.id);
    });

    if (unresolved.length > 0) {
      await failRows(
        tx,
        unresolved,
        "No encontramos a la persona de este horario (¿se omitió su fila?).",
      );
    }

    if (resolved.length === 0) {
      return rows.length;
    }

    const personIds = resolved.map(({ personId }) => personId);
    const existing = await tx
      .select()
      .from(personSchedules)
      .where(inArray(personSchedules.personId, personIds));
    const existingByPerson = new Map(
      existing.map((schedule) => [schedule.personId, schedule]),
    );
    const audit: (typeof auditEvents.$inferInsert)[] = [];

    await tx.execute(sql`
      insert into person_schedules (person_id, entrada, salida_comer, regreso_comer, salida)
      select v.person_id, v.entrada, v.salida_comer, v.regreso_comer, v.salida
      from jsonb_to_recordset(${JSON.stringify(
        resolved.map(({ row, personId }) => ({
          person_id: personId,
          entrada: row.normalized.times?.entrada ?? null,
          salida_comer: row.normalized.times?.salidaComer ?? null,
          regreso_comer: row.normalized.times?.regresoComer ?? null,
          salida: row.normalized.times?.salida ?? null,
        })),
      )}::jsonb) as v(person_id uuid, entrada text, salida_comer text, regreso_comer text, salida text)
      on conflict (person_id) do update set
        entrada = coalesce(excluded.entrada, person_schedules.entrada),
        salida_comer = coalesce(excluded.salida_comer, person_schedules.salida_comer),
        regreso_comer = coalesce(excluded.regreso_comer, person_schedules.regreso_comer),
        salida = coalesce(excluded.salida, person_schedules.salida),
        deleted_at = null,
        updated_at = now()
    `);

    const marks = resolved.map(({ row, personId }) => {
      const before = existingByPerson.get(personId);

      audit.push({
        actorUserId: job.actorUserId,
        resourceType: "person",
        resourceId: personId,
        action: "update",
        source: "import",
        payload: {
          summary: "Horario actualizado por importación",
          after: row.normalized.times,
        },
      });

      return {
        id: row.id,
        targetPersonId: personId,
        previous: before
          ? {
              entrada: before.entrada,
              salidaComer: before.salidaComer,
              regresoComer: before.regresoComer,
              salida: before.salida,
              deletedAt: before.deletedAt,
            }
          : null,
      };
    });

    await markRows(tx, marks);
    await tx.insert(auditEvents).values(audit);
    await tx
      .update(importJobs)
      .set({
        counts: sql`jsonb_set(${importJobs.counts}, '{applied}', to_jsonb(coalesce((${importJobs.counts}->>'applied')::int, 0) + ${marks.length}))`,
      })
      .where(eq(importJobs.id, job.id));

    return rows.length;
  });

const countRemaining = async (jobId: string, sheet?: string) => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(importRows)
    .where(
      and(
        eq(importRows.jobId, jobId),
        inArray(importRows.action, ["create", "update"]),
        isNull(importRows.appliedAt),
        sheet ? eq(importRows.sheet, sheet) : undefined,
      ),
    );

  return row?.count ?? 0;
};

const finish = async (job: ImportJob) => {
  const [done] = await db
    .update(importJobs)
    .set({ status: "applied", appliedAt: new Date() })
    .where(and(eq(importJobs.id, job.id), eq(importJobs.status, "applying")))
    .returning();

  if (done) {
    const counts = done.counts as ImportJobCounts;

    await recordAuditEvent({
      actorUserId: job.actorUserId,
      resourceType: "people_import",
      resourceId: job.id,
      action: "import",
      source: "import",
      payload: {
        summary: `Importación de ${job.fileName}: ${counts.applied ?? 0} filas aplicadas`,
        after: { fileName: job.fileName, counts },
      },
    });
  }
};

/**
 * One apply step: personas batches, then managers, then horarios. The page
 * calls it until `done`; killing the process loses at most the open batch.
 */
export const applyJobStep = async (jobId: string): Promise<ApplyProgress> => {
  const [loaded] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, jobId))
    .limit(1);

  if (!loaded) {
    throw new ImportBlockedError(
      "No encontramos esta importación.",
      "not_applicable",
    );
  }

  const job = await beginApply(loaded);

  try {
    if ((await countRemaining(jobId, "personas")) > 0) {
      await applyPersonasBatch(job);

      return progress("personas", jobId);
    }

    if (!job.counts.managersApplied) {
      await applyManagers(job);

      return progress("managers", jobId);
    }

    if ((await countRemaining(jobId, "horarios")) > 0) {
      await applyHorariosBatch(job);

      return progress("horarios", jobId);
    }

    await finish(job);

    return progress("done", jobId);
  } catch (error) {
    // Keep the rows' state: the user can resume from "Continuar importación".
    await db
      .update(importJobs)
      .set({
        status: "failed",
        failureMessage: String((error as Error).message).slice(0, 500),
      })
      .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "applying")));

    throw error;
  }
};

const progress = async (
  phase: ApplyPhase,
  jobId: string,
): Promise<ApplyProgress> => {
  const [job] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, jobId))
    .limit(1);
  const remaining = await countRemaining(jobId);

  return {
    phase,
    done: job?.status === "applied",
    applied: job?.counts.applied ?? 0,
    remaining,
  };
};

/** Releases the apply lock without losing progress. */
export const pauseApply = async (jobId: string) => {
  const [paused] = await db
    .update(importJobs)
    .set({ status: "failed", failureMessage: "Pausada por el usuario." })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "applying")))
    .returning({ id: importJobs.id });

  return Boolean(paused);
};
