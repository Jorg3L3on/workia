import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { db, withTransaction, type DbTransaction } from "@/lib/db";
import {
  auditEvents,
  contracts,
  importJobs,
  importRows,
  people,
  personSchedules,
  type ImportJob,
} from "@/lib/db/schema";
import { env } from "@/env";

import { ImportBlockedError } from "./apply";

export const UNDO_BATCH_SIZE = 200;

export type UndoBlocker = {
  type: "persona" | "contrato" | "horario";
  id: string;
  name: string;
  reason: string;
};

export type UndoPreview = {
  allowed: boolean;
  /** Why it is not allowed, in Spanish, ready to show. */
  reason: string | null;
  windowEndsAt: string | null;
  blockers: UndoBlocker[];
  blockerTotal: number;
  rows: number;
};

/** `(a, b, c)` as bound uuid parameters: drizzle expands arrays into a tuple. */
const uuidList = (ids: string[]) =>
  sql`(${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;

const windowEnd = (job: ImportJob) =>
  job.appliedAt
    ? new Date(
        job.appliedAt.getTime() + env.IMPORT_UNDO_WINDOW_HOURS * 3_600_000,
      )
    : null;

/**
 * Records the import touched that someone changed afterwards. Everything the
 * import wrote carries an `updated_at` at or before `job.applied_at`, so any
 * later edit shows up, as do dependents created on top of imported people.
 */
const findBlockers = async (
  executor: DbTransaction | typeof db,
  job: ImportJob,
  rowIds?: string[],
) => {
  const idFilter = rowIds ? sql`and id in ${uuidList(rowIds)}` : sql``;
  const appliedAt = job.appliedAt ?? new Date();

  const result = await executor.execute(sql`
    with r as (
      select * from import_rows
      where company_id = ${job.companyId} and job_id = ${job.id} and applied_at is not null and undone_at is null ${idFilter}
    ), jobpeople as (
      select target_person_id as id from import_rows where company_id = ${job.companyId} and job_id = ${job.id} and target_person_id is not null
    ), jobcontracts as (
      select target_contract_id as id from import_rows where company_id = ${job.companyId} and job_id = ${job.id} and target_contract_id is not null
    ), blockers as (
      select 'persona' as type, p.id::text as id,
             p.nombres || ' ' || p.apellido_paterno as name,
             case when p.deleted_at is not null then 'Fue borrada después de la importación.'
                  else 'Se editó después de la importación.' end as reason
      from r join people p on p.id = r.target_person_id
      where r.sheet = 'personas' and (p.updated_at > ${appliedAt} or p.deleted_at is not null)
      union all
      select 'persona', p.id::text, p.nombres || ' ' || p.apellido_paterno,
             'Tiene contratos creados después de la importación.'
      from r join people p on p.id = r.target_person_id
      where r.sheet = 'personas' and r.previous_snapshot is null
        and exists (select 1 from contracts c where c.person_id = p.id and c.deleted_at is null
                    and c.id not in (select id from jobcontracts))
      union all
      select 'persona', p.id::text, p.nombres || ' ' || p.apellido_paterno,
             'Es jefe directo de personas que no vienen de la importación.'
      from r join people p on p.id = r.target_person_id
      where r.sheet = 'personas' and r.previous_snapshot is null
        and exists (select 1 from people s where s.manager_id = p.id and s.deleted_at is null
                    and s.id not in (select id from jobpeople))
      union all
      select 'persona', p.id::text, p.nombres || ' ' || p.apellido_paterno,
             'Tiene equipo en resguardo.'
      from r join people p on p.id = r.target_person_id
      where r.sheet = 'personas' and r.previous_snapshot is null
        and exists (select 1 from assets a where a.holder_id = p.id)
      union all
      select 'contrato', c.id::text, p.nombres || ' ' || p.apellido_paterno,
             case when c.deleted_at is not null then 'El contrato fue borrado después de la importación.'
                  else 'El contrato se editó después de la importación.' end
      from r join contracts c on c.id = r.target_contract_id join people p on p.id = c.person_id
      where r.sheet = 'contratos' and (c.updated_at > ${appliedAt} or c.deleted_at is not null)
      union all
      select 'horario', s.id::text, p.nombres || ' ' || p.apellido_paterno,
             'El horario se editó después de la importación.'
      from r join person_schedules s on s.person_id = r.target_person_id join people p on p.id = s.person_id
      where r.sheet = 'horarios' and s.updated_at > ${appliedAt}
    )
    select type, id, name, reason, count(*) over ()::int as total
    from blockers order by name limit 50
  `);
  const rows = result.rows as {
    type: UndoBlocker["type"];
    id: string;
    name: string;
    reason: string;
    total: number;
  }[];

  return {
    total: rows[0]?.total ?? 0,
    blockers: rows.map(({ type, id, name, reason }) => ({
      type,
      id,
      name,
      reason,
    })),
  };
};

const countUndoable = async (companyId: string, jobId: string) => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importRows.jobId, jobId),
        isNotNull(importRows.appliedAt),
        isNull(importRows.undoneAt),
      ),
    );

  return row?.count ?? 0;
};

export const previewUndo = async (
  companyId: string,
  jobId: string,
): Promise<UndoPreview> => {
  const [job] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.companyId, companyId), eq(importJobs.id, jobId)))
    .limit(1);

  if (!job) {
    throw new ImportBlockedError(
      "No encontramos esta importación.",
      "not_applicable",
    );
  }

  const rows = await countUndoable(companyId, jobId);
  const ends = windowEnd(job);
  const base = {
    windowEndsAt: ends?.toISOString() ?? null,
    rows,
    blockers: [],
    blockerTotal: 0,
  };

  if (job.status !== "applied") {
    return {
      ...base,
      allowed: false,
      reason: "Solo se pueden deshacer importaciones aplicadas.",
    };
  }

  const resumed = (job.counts.undone ?? 0) > 0;

  // Once an undo has started it may finish even if the window closes meanwhile.
  if (!resumed && ends && ends.getTime() < Date.now()) {
    return {
      ...base,
      allowed: false,
      reason: `Pasaron más de ${env.IMPORT_UNDO_WINDOW_HOURS} horas desde que se aplicó.`,
    };
  }

  const { blockers, total } = await findBlockers(db, job);

  if (total > 0) {
    return {
      ...base,
      blockers,
      blockerTotal: total,
      allowed: false,
      reason: `${total} registros cambiaron después de la importación; no se puede deshacer sin perder esos cambios.`,
    };
  }

  return { ...base, allowed: true, reason: null };
};

type UndoRow = {
  id: string;
  sheet: string;
  targetPersonId: string | null;
  targetContractId: string | null;
  previousSnapshot: Record<string, unknown> | null;
};

const PERSON_RESTORE = [
  ["nombres", "nombres"],
  ["apellidoPaterno", "apellido_paterno"],
  ["apellidoMaterno", "apellido_materno"],
  ["email", "email"],
  ["telefono", "telefono"],
  ["fechaNacimiento", "fecha_nacimiento"],
  ["fechaIngreso", "fecha_ingreso"],
  ["areaId", "area_id"],
  ["positionId", "position_id"],
  ["siteId", "site_id"],
  ["rfc", "rfc"],
  ["curp", "curp"],
  ["nss", "nss"],
  ["status", "status"],
  ["managerId", "manager_id"],
] as const;

const undoBatch = async (
  job: ImportJob,
  sheet: "contratos" | "horarios" | "personas",
) =>
  withTransaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${job.id}, 0))`,
    );

    const rows = (await tx
      .select({
        id: importRows.id,
        sheet: importRows.sheet,
        targetPersonId: importRows.targetPersonId,
        targetContractId: importRows.targetContractId,
        previousSnapshot: importRows.previousSnapshot,
      })
      .from(importRows)
      .where(
        and(
          eq(importRows.companyId, job.companyId),
          eq(importRows.jobId, job.id),
          eq(importRows.sheet, sheet),
          isNotNull(importRows.appliedAt),
          isNull(importRows.undoneAt),
        ),
      )
      .orderBy(asc(importRows.rowNumber))
      .limit(UNDO_BATCH_SIZE)) as UndoRow[];

    if (rows.length === 0) {
      return 0;
    }

    const { total } = await findBlockers(
      tx,
      job,
      rows.map((row) => row.id),
    );

    if (total > 0) {
      throw new ImportBlockedError(
        "Algunos registros cambiaron mientras se deshacía la importación.",
        "changed",
      );
    }

    const created = rows.filter((row) => row.previousSnapshot === null);
    const updated = rows.filter((row) => row.previousSnapshot !== null);
    const audit: (typeof auditEvents.$inferInsert)[] = [];
    const event = (
      resourceType: "person" | "contract",
      resourceId: string,
      summary: string,
    ) =>
      audit.push({
        companyId: job.companyId,
        actorUserId: job.actorUserId,
        resourceType,
        resourceId,
        action: "undo",
        source: "import",
        payload: { summary },
      });

    if (sheet === "personas") {
      if (created.length > 0) {
        const ids = created.map((row) => row.targetPersonId!);

        await tx
          .update(people)
          .set({ deletedAt: new Date() })
          .where(
            and(eq(people.companyId, job.companyId), inArray(people.id, ids)),
          );
        ids.forEach((id) =>
          event("person", id, "Alta revertida: se deshizo la importación"),
        );
      }

      if (updated.length > 0) {
        const payload = updated.map((row) => ({
          id: row.targetPersonId,
          ...Object.fromEntries(
            PERSON_RESTORE.map(([key, column]) => [
              column,
              row.previousSnapshot![key] ?? null,
            ]),
          ),
        }));

        await tx.execute(sql`
          update people p set
            nombres = v.nombres, apellido_paterno = v.apellido_paterno,
            apellido_materno = v.apellido_materno, email = v.email, telefono = v.telefono,
            fecha_nacimiento = v.fecha_nacimiento::date, fecha_ingreso = v.fecha_ingreso::date,
            area_id = v.area_id::uuid, position_id = v.position_id::uuid, site_id = v.site_id::uuid,
            rfc = v.rfc, curp = v.curp, nss = v.nss, status = v.status::person_status,
            manager_id = v.manager_id::uuid, updated_at = now()
          from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) as v(
            id uuid, nombres text, apellido_paterno text, apellido_materno text, email text,
            telefono text, fecha_nacimiento text, fecha_ingreso text, area_id text,
            position_id text, site_id text, rfc text, curp text, nss text, status text,
            manager_id text
          )
          where p.id = v.id and p.company_id = ${job.companyId}
        `);
        updated.forEach((row) =>
          event(
            "person",
            row.targetPersonId!,
            "Datos restaurados: se deshizo la importación",
          ),
        );
      }
    }

    if (sheet === "horarios") {
      const createdIds = created.map((row) => row.targetPersonId!);

      if (createdIds.length > 0) {
        await tx
          .update(personSchedules)
          .set({
            entrada: null,
            salidaComer: null,
            regresoComer: null,
            salida: null,
            deletedAt: new Date(),
          })
          .where(
            and(
              eq(personSchedules.companyId, job.companyId),
              inArray(personSchedules.personId, createdIds),
            ),
          );
        createdIds.forEach((id) =>
          event("person", id, "Horario revertido: se deshizo la importación"),
        );
      }

      if (updated.length > 0) {
        await tx.execute(sql`
          update person_schedules s set
            entrada = v.entrada, salida_comer = v.salida_comer,
            regreso_comer = v.regreso_comer, salida = v.salida,
            deleted_at = v.deleted_at::timestamptz, updated_at = now()
          from jsonb_to_recordset(${JSON.stringify(
            updated.map((row) => ({
              person_id: row.targetPersonId,
              entrada: row.previousSnapshot!.entrada ?? null,
              salida_comer: row.previousSnapshot!.salidaComer ?? null,
              regreso_comer: row.previousSnapshot!.regresoComer ?? null,
              salida: row.previousSnapshot!.salida ?? null,
              deleted_at: row.previousSnapshot!.deletedAt ?? null,
            })),
          )}::jsonb) as v(person_id uuid, entrada text, salida_comer text, regreso_comer text, salida text, deleted_at text)
          where s.person_id = v.person_id and s.company_id = ${job.companyId}
        `);
        updated.forEach((row) =>
          event(
            "person",
            row.targetPersonId!,
            "Horario restaurado: se deshizo la importación",
          ),
        );
      }
    }

    if (sheet === "contratos") {
      if (created.length > 0) {
        const ids = created.map((row) => row.targetContractId!);

        await tx
          .update(contracts)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(contracts.companyId, job.companyId),
              inArray(contracts.id, ids),
            ),
          );
        ids.forEach((id) =>
          event(
            "contract",
            id,
            "Contrato revertido: se deshizo la importación",
          ),
        );
      }

      if (updated.length > 0) {
        await tx.execute(sql`
          update contracts c set
            type = v.type::contract_type, end_date = v.end_date::date,
            notice_window = v.notice_window::contract_notice_window,
            status = v.status::contract_status, template_id = v.template_id::uuid,
            template_name = v.template_name, generated_text = v.generated_text,
            previous_contract_id = v.previous_contract_id::uuid, updated_at = now()
          from jsonb_to_recordset(${JSON.stringify(
            updated.map((row) => ({
              id: row.targetContractId,
              type: row.previousSnapshot!.type,
              end_date: row.previousSnapshot!.endDate ?? null,
              notice_window: row.previousSnapshot!.noticeWindow,
              status: row.previousSnapshot!.status,
              template_id: row.previousSnapshot!.templateId ?? null,
              template_name: row.previousSnapshot!.templateName ?? null,
              generated_text: row.previousSnapshot!.generatedText,
              previous_contract_id:
                row.previousSnapshot!.previousContractId ?? null,
            })),
          )}::jsonb) as v(id uuid, type text, end_date text, notice_window text, status text, template_id text, template_name text, generated_text text, previous_contract_id text)
          where c.id = v.id and c.company_id = ${job.companyId}
        `);
        updated.forEach((row) =>
          event(
            "contract",
            row.targetContractId!,
            "Contrato restaurado: se deshizo la importación",
          ),
        );
      }
    }

    await tx
      .update(importRows)
      .set({ undoneAt: new Date() })
      .where(
        and(
          eq(importRows.companyId, job.companyId),
          inArray(
            importRows.id,
            rows.map((row) => row.id),
          ),
        ),
      );
    await tx.insert(auditEvents).values(audit);
    await tx
      .update(importJobs)
      .set({
        counts: sql`jsonb_set(${importJobs.counts}, '{undone}', to_jsonb(coalesce((${importJobs.counts}->>'undone')::int, 0) + ${rows.length}))`,
      })
      .where(
        and(eq(importJobs.companyId, job.companyId), eq(importJobs.id, job.id)),
      );

    return rows.length;
  });

/** Removes catalog entries the import created, unless something active uses them. */
const removeCreatedCatalogs = async (job: ImportJob) => {
  const created = job.counts.createdCatalogs;

  if (!created) {
    return;
  }

  const now = new Date();

  if (created.positions.length > 0) {
    await db.execute(sql`
      update positions set deleted_at = ${now}
      where company_id = ${job.companyId} and id in ${uuidList(created.positions)} and deleted_at is null
        and not exists (select 1 from people p where p.position_id = positions.id and p.deleted_at is null)
    `);
  }

  if (created.areas.length > 0) {
    await db.execute(sql`
      update areas set deleted_at = ${now}
      where company_id = ${job.companyId} and id in ${uuidList(created.areas)} and deleted_at is null
        and not exists (select 1 from people p where p.area_id = areas.id and p.deleted_at is null)
        and not exists (select 1 from positions q where q.area_id = areas.id and q.deleted_at is null)
    `);
  }

  if (created.sites.length > 0) {
    await db.execute(sql`
      update sites set deleted_at = ${now}
      where company_id = ${job.companyId} and id in ${uuidList(created.sites)} and deleted_at is null
        and not exists (select 1 from people p where p.site_id = sites.id and p.deleted_at is null)
    `);
  }
};

export type UndoProgress = { done: boolean; remaining: number; undone: number };

/** One undo step (≤200 rows in a transaction); the page loops until `done`. */
export const undoJobStep = async (
  companyId: string,
  jobId: string,
): Promise<UndoProgress> => {
  const preview = await previewUndo(companyId, jobId);

  if (!preview.allowed) {
    throw new ImportBlockedError(
      preview.reason ?? "No se puede deshacer.",
      "not_applicable",
    );
  }

  const [job] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.companyId, companyId), eq(importJobs.id, jobId)))
    .limit(1);

  // Dependents first: contracts and schedules before the people they belong to.
  for (const sheet of ["contratos", "horarios", "personas"] as const) {
    const done = await undoBatch(job, sheet);

    if (done > 0) {
      const remaining = await countUndoable(companyId, jobId);

      return {
        done: false,
        remaining,
        undone: (job.counts.undone ?? 0) + done,
      };
    }
  }

  await removeCreatedCatalogs(job);

  const [finished] = await db
    .update(importJobs)
    .set({ status: "undone", undoneAt: new Date() })
    .where(
      and(
        eq(importJobs.companyId, companyId),
        eq(importJobs.id, jobId),
        eq(importJobs.status, "applied"),
      ),
    )
    .returning();

  if (finished) {
    await recordAuditEvent({
      companyId,
      actorUserId: job.actorUserId,
      resourceType: "people_import",
      resourceId: jobId,
      action: "undo",
      source: "import",
      payload: {
        summary: `Importación deshecha: ${job.fileName}`,
        after: { fileName: job.fileName, undone: job.counts.undone ?? 0 },
      },
    });
  }

  return { done: true, remaining: 0, undone: job.counts.undone ?? 0 };
};
