import { randomUUID } from "node:crypto";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import {
  recordAuditEvent,
  snapshotContract,
  snapshotPerson,
} from "@/lib/audit";
import { db, withTransaction, type DbTransaction } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import {
  areas,
  auditEvents,
  contractTemplates,
  contracts,
  importJobs,
  importRows,
  people,
  personSchedules,
  positions,
  sites,
  type ImportJob,
  type ImportJobCounts,
} from "@/lib/db/schema";

import { formatContractDate } from "@/lib/contracts/schema";
import {
  buildContractScheduleSnapshot,
  fillContractTemplate,
} from "@/lib/contracts/schema";
import { formatHorarioToken } from "@/lib/people/schema";

import {
  contractIdentity,
  importedContractText,
  IMPORTED_TEMPLATE_NAME,
} from "./contract-rows";
import { catalogKey } from "./format";
import { classifyPersonRow } from "./person-rows";
import type { ManagerRef, NormalizedContract, NormalizedPerson } from "./types";
import { loadLookups, restartValidation, validateJobStep } from "./validate";

export const APPLY_BATCH_SIZE = 200;

/** Phases run in this order; each is resumable because rows carry their mark. */
export type ApplyPhase =
  "personas" | "managers" | "horarios" | "contratos" | "chain" | "done";

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
  targetContractId?: string | null;
};

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
    await restartValidation(job.companyId, job.id, {});
    let step;

    do {
      step = await validateJobStep(job.companyId, job.id);
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
          eq(importJobs.companyId, job.companyId),
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
  companyId: string,
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
    /** Ids of entries this call inserted, for undo. */
    inserted: {
      areas: [] as string[],
      positions: [] as string[],
      sites: [] as string[],
    },
  };

  if (needed.length === 0) {
    return created;
  }

  // Sequential: a transaction owns one connection, which runs one query at a time.
  const areaRows = await tx
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(and(eq(areas.companyId, companyId), isNull(areas.deletedAt)));
  const positionRows = await tx
    .select({ id: positions.id, name: positions.name })
    .from(positions)
    .where(
      and(eq(positions.companyId, companyId), isNull(positions.deletedAt)),
    );
  const siteRows = await tx
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(and(eq(sites.companyId, companyId), isNull(sites.deletedAt)));
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
      companyId,
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
          .values({ companyId, name: missing.area })
          .returning({ id: areas.id });
        areaByKey.set(key, id);
        created.inserted.areas.push(id);
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
          .values({ companyId, name: missing.position, areaId })
          .returning({ id: positions.id });
        positionByKey.set(key, id);
        created.inserted.positions.push(id);
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
          .values({ companyId, name: missing.site, kind: "sucursal" })
          .returning({ id: sites.id });
        siteByKey.set(key, id);
        created.inserted.sites.push(id);
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
  companyId: string,
  jobId: string,
  sheet: "personas" | "horarios" | "contratos",
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
      targetContractId: importRows.targetContractId,
    })
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
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
  companyId: string,
  marks: {
    id: string;
    targetPersonId: string | null;
    previous: unknown;
    targetContractId?: string | null;
  }[],
) =>
  tx.execute(sql`
    update import_rows r set
      applied_at = now(),
      target_person_id = v.target_person_id,
      target_contract_id = coalesce(v.target_contract_id, r.target_contract_id),
      previous_snapshot = nullif(v.previous, 'null'::jsonb)
    from jsonb_to_recordset(${JSON.stringify(
      marks.map((mark) => ({
        id: mark.id,
        target_person_id: mark.targetPersonId,
        target_contract_id: mark.targetContractId ?? null,
        previous: mark.previous ?? null,
      })),
    )}::jsonb) as v(id uuid, target_person_id uuid, target_contract_id uuid, previous jsonb)
    where r.id = v.id and r.company_id = ${companyId}
  `);

const failRows = (
  tx: DbTransaction,
  companyId: string,
  ids: string[],
  message: string,
) =>
  tx
    .update(importRows)
    .set({ action: "error", errors: [{ message }] })
    .where(
      and(eq(importRows.companyId, companyId), inArray(importRows.id, ids)),
    );

/** One transaction: ≤ APPLY_BATCH_SIZE people created or updated, audited, marked. */
const applyPersonasBatch = async (job: ImportJob) =>
  withTransaction(async (tx) => {
    await lockJob(tx, job.id);

    const rows = await personRowsToApply(
      tx,
      job.companyId,
      job.id,
      "personas",
      APPLY_BATCH_SIZE,
    );

    if (rows.length === 0) {
      return 0;
    }

    // The database may have changed since the review: classify again.
    const lookups = await loadLookups(
      job.companyId,
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
        job.companyId,
        stale,
        "Los datos cambiaron desde la revisión; vuelve a importar esta fila.",
      );
    }

    if (ready.length === 0) {
      return stale.length;
    }

    const catalogs = await ensureCatalogs(
      tx,
      job.companyId,
      ready,
      job.actorUserId,
    );
    const insertedCatalogs = catalogs.inserted;

    if (
      insertedCatalogs.areas.length +
        insertedCatalogs.positions.length +
        insertedCatalogs.sites.length >
      0
    ) {
      // We hold the job's advisory lock, so read-modify-write is safe.
      const [{ counts }] = await tx
        .select({ counts: importJobs.counts })
        .from(importJobs)
        .where(
          and(
            eq(importJobs.companyId, job.companyId),
            eq(importJobs.id, job.id),
          ),
        );
      const known = counts.createdCatalogs ?? {
        areas: [],
        positions: [],
        sites: [],
      };

      await tx
        .update(importJobs)
        .set({
          counts: {
            ...counts,
            createdCatalogs: {
              areas: [...known.areas, ...insertedCatalogs.areas],
              positions: [...known.positions, ...insertedCatalogs.positions],
              sites: [...known.sites, ...insertedCatalogs.sites],
            },
          },
        })
        .where(
          and(
            eq(importJobs.companyId, job.companyId),
            eq(importJobs.id, job.id),
          ),
        );
    }
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
          companyId: job.companyId,
          status: values.status ?? "activa",
        })),
      );

      for (const { row, id, values } of inserted) {
        marks.push({ id: row.id, targetPersonId: id, previous: null });
        audit.push({
          companyId: job.companyId,
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
        .where(
          and(
            eq(people.companyId, job.companyId),
            inArray(people.id, ids),
            isNull(people.deletedAt),
          ),
        )
        .for("update");
      const byId = new Map(current.map((person) => [person.id, person]));
      const live = updates.filter((row) => byId.has(row.targetPersonId!));
      const gone = updates.filter((row) => !byId.has(row.targetPersonId!));

      if (gone.length > 0) {
        await failRows(
          tx,
          job.companyId,
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
          where p.id = v.id and p.company_id = ${job.companyId}
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
            companyId: job.companyId,
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
      await markRows(tx, job.companyId, marks);
    }

    if (audit.length > 0) {
      await tx.insert(auditEvents).values(audit);
    }

    await tx
      .update(importJobs)
      .set({
        counts: sql`jsonb_set(${importJobs.counts}, '{applied}', to_jsonb(coalesce((${importJobs.counts}->>'applied')::int, 0) + ${marks.length}))`,
      })
      .where(
        and(eq(importJobs.companyId, job.companyId), eq(importJobs.id, job.id)),
      );

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
          eq(importRows.companyId, job.companyId),
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
        where p.id = v.id and p.company_id = ${job.companyId}
          and p.manager_id is distinct from v.manager_id
      `);
    }

    await tx
      .update(importJobs)
      .set({
        counts: sql`${importJobs.counts} || '{"managersApplied": true}'::jsonb`,
      })
      .where(
        and(eq(importJobs.companyId, job.companyId), eq(importJobs.id, job.id)),
      );

    return links.length;
  });

/** Schedules: upsert per person, remembering the previous one for undo. */
const applyHorariosBatch = async (job: ImportJob) =>
  withTransaction(async (tx) => {
    await lockJob(tx, job.id);

    const rows = await personRowsToApply(
      tx,
      job.companyId,
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
        and(
          eq(importRows.companyId, job.companyId),
          inArray(
            importRows.id,
            rows.map((row) => row.id),
          ),
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
    const lookups = await loadLookups(job.companyId, keys, tx);
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
        job.companyId,
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
      .where(
        and(
          eq(personSchedules.companyId, job.companyId),
          inArray(personSchedules.personId, personIds),
        ),
      );
    const existingByPerson = new Map(
      existing.map((schedule) => [schedule.personId, schedule]),
    );
    const audit: (typeof auditEvents.$inferInsert)[] = [];

    await tx.execute(sql`
      insert into person_schedules (company_id, person_id, entrada, salida_comer, regreso_comer, salida)
      select ${job.companyId}::uuid, v.person_id, v.entrada, v.salida_comer, v.regreso_comer, v.salida
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
      where person_schedules.company_id = excluded.company_id
    `);

    const marks = resolved.map(({ row, personId }) => {
      const before = existingByPerson.get(personId);

      audit.push({
        companyId: job.companyId,
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

    await markRows(tx, job.companyId, marks);
    await tx.insert(auditEvents).values(audit);
    await tx
      .update(importJobs)
      .set({
        counts: sql`jsonb_set(${importJobs.counts}, '{applied}', to_jsonb(coalesce((${importJobs.counts}->>'applied')::int, 0) + ${marks.length}))`,
      })
      .where(
        and(eq(importJobs.companyId, job.companyId), eq(importJobs.id, job.id)),
      );

    return rows.length;
  });

/** Contracts: create or update per (person, start date), with text and schedule snapshot. */
const applyContratosBatch = async (job: ImportJob) =>
  withTransaction(async (tx) => {
    await lockJob(tx, job.id);

    const rows = await personRowsToApply(
      tx,
      job.companyId,
      job.id,
      "contratos",
      APPLY_BATCH_SIZE,
    );

    if (rows.length === 0) {
      return 0;
    }

    const staged = rows.map((row) => ({
      row,
      contract: row.normalized as unknown as NormalizedContract,
    }));
    const lookups = await loadLookups(
      job.companyId,
      staged.map(({ row, contract }) => ({
        rowNumber: row.rowNumber,
        idWorkia: contract.personKey.idWorkia,
        curp: contract.personKey.curp,
        rfc: null,
      })),
      tx,
    );
    const personFor = ({ contract }: (typeof staged)[number]) => {
      const { idWorkia, curp } = contract.personKey;
      const person =
        (idWorkia ? lookups.byId.get(idWorkia.toLowerCase()) : undefined) ??
        (curp ? lookups.byCurp.get(curp) : undefined);

      return person && !person.deletedAt ? person : undefined;
    };
    const unresolved = staged.filter((entry) => !personFor(entry));

    if (unresolved.length > 0) {
      await failRows(
        tx,
        job.companyId,
        unresolved.map(({ row }) => row.id),
        "No encontramos a la persona de este contrato.",
      );
    }

    const resolved = staged.filter((entry) => personFor(entry));

    if (resolved.length === 0) {
      return rows.length;
    }

    const personIds = [
      ...new Set(resolved.map((entry) => personFor(entry)!.id)),
    ];
    const existing = (await tx
      .select()
      .from(contracts)
      .where(
        and(
          eq(contracts.companyId, job.companyId),
          inArray(contracts.personId, personIds),
          isNull(contracts.deletedAt),
        ),
      )
      .for("update")) as (typeof contracts.$inferSelect)[];
    const existingByIdentity = new Map(
      existing.map((c) => [contractIdentity(c.personId, c.startDate), c]),
    );

    const stale: string[] = [];
    const ready: {
      row: StagedRow;
      contract: NormalizedContract;
      personId: string;
      match?: typeof contracts.$inferSelect;
    }[] = [];

    for (const entry of resolved) {
      const personId = personFor(entry)!.id;
      const match = existingByIdentity.get(
        contractIdentity(personId, entry.contract.startDate),
      );
      const freshAction = match ? "update" : "create";

      if (
        (entry.row.action === "create" && match) ||
        (entry.row.action === "update" &&
          (!match || match.id !== entry.row.targetContractId)) ||
        freshAction !== entry.row.action
      ) {
        stale.push(entry.row.id);
      } else {
        ready.push({
          row: entry.row,
          contract: entry.contract,
          personId,
          match,
        });
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
        job.companyId,
        stale,
        "Los contratos de esta persona cambiaron desde la revisión.",
      );
    }

    if (ready.length === 0) {
      return rows.length;
    }

    // Context for contract text and the schedule snapshot, two queries per batch.
    const readyPersonIds = [...new Set(ready.map((entry) => entry.personId))];
    const personRows = await tx
      .select({
        id: people.id,
        nombres: people.nombres,
        apellidoPaterno: people.apellidoPaterno,
        apellidoMaterno: people.apellidoMaterno,
        rfc: people.rfc,
        areaName: areas.name,
        positionName: positions.name,
        siteName: sites.name,
      })
      .from(people)
      .leftJoin(areas, eq(people.areaId, areas.id))
      .leftJoin(positions, eq(people.positionId, positions.id))
      .leftJoin(sites, eq(people.siteId, sites.id))
      .where(
        and(
          eq(people.companyId, job.companyId),
          inArray(people.id, readyPersonIds),
        ),
      );
    const scheduleRows = await tx
      .select()
      .from(personSchedules)
      .where(
        and(
          eq(personSchedules.companyId, job.companyId),
          inArray(personSchedules.personId, readyPersonIds),
          isNull(personSchedules.deletedAt),
        ),
      );
    const templateIds = [
      ...new Set(
        ready.flatMap((entry) =>
          entry.contract.templateId ? [entry.contract.templateId] : [],
        ),
      ),
    ];
    const templateRows = templateIds.length
      ? await tx
          .select()
          .from(contractTemplates)
          .where(
            and(
              eq(contractTemplates.companyId, job.companyId),
              inArray(contractTemplates.id, templateIds),
            ),
          )
      : [];
    const personById = new Map(personRows.map((p) => [p.id, p]));
    const scheduleByPerson = new Map(scheduleRows.map((s) => [s.personId, s]));
    const templateById = new Map(templateRows.map((t) => [t.id, t]));

    const textFor = (entry: (typeof ready)[number]) => {
      const person = personById.get(entry.personId)!;
      const template = entry.contract.templateId
        ? templateById.get(entry.contract.templateId)
        : undefined;
      const fullName = [
        person.nombres,
        person.apellidoPaterno,
        person.apellidoMaterno,
      ]
        .filter(Boolean)
        .join(" ");

      if (!template) {
        return importedContractText({
          fullName,
          type: entry.contract.type,
          startDate: entry.contract.startDate,
          endDate: entry.contract.endDate,
          formatDate: formatContractDate,
        });
      }

      return fillContractTemplate(template.body, {
        nombres: person.nombres,
        apellidoPaterno: person.apellidoPaterno,
        apellidoMaterno: person.apellidoMaterno,
        puesto: person.positionName,
        area: person.areaName,
        sucursal: person.siteName,
        rfc: person.rfc,
        horario: formatHorarioToken(scheduleByPerson.get(entry.personId)),
        fechaInicio: entry.contract.startDate,
        fechaFin: entry.contract.endDate,
      });
    };

    const creates = ready.filter((entry) => !entry.match);
    const updates = ready.filter((entry) => entry.match);
    const marks: {
      id: string;
      targetPersonId: string | null;
      previous: unknown;
      targetContractId: string;
    }[] = [];
    const audit: (typeof auditEvents.$inferInsert)[] = [];

    if (creates.length > 0) {
      const inserted = creates.map((entry) => ({
        entry,
        id: randomUUID(),
        values: {
          companyId: job.companyId,
          personId: entry.personId,
          type: entry.contract.type,
          startDate: entry.contract.startDate,
          endDate: entry.contract.endDate,
          noticeWindow: entry.contract.noticeWindow,
          templateId: entry.contract.templateId,
          templateName: entry.contract.templateName ?? IMPORTED_TEMPLATE_NAME,
          generatedText: textFor(entry),
          ...buildContractScheduleSnapshot(
            scheduleByPerson.get(entry.personId),
          ),
          status: entry.contract.status,
        },
      }));

      await tx
        .insert(contracts)
        .values(inserted.map(({ id, values }) => ({ id, ...values })));

      for (const { entry, id, values } of inserted) {
        marks.push({
          id: entry.row.id,
          targetPersonId: entry.personId,
          previous: null,
          targetContractId: id,
        });
        audit.push({
          companyId: job.companyId,
          actorUserId: job.actorUserId,
          resourceType: "contract",
          resourceId: id,
          action: "create",
          source: "import",
          payload: {
            summary: "Contrato importado",
            after: snapshotContract({ id, ...values }),
          },
        });
      }
    }

    if (updates.length > 0) {
      await tx.execute(sql`
        update contracts c set
          type = v.type::contract_type,
          end_date = v.end_date::date,
          notice_window = v.notice_window::contract_notice_window,
          status = v.status::contract_status,
          template_id = coalesce(v.template_id::uuid, c.template_id),
          template_name = coalesce(v.template_name, c.template_name),
          generated_text = coalesce(v.generated_text, c.generated_text),
          updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(
          updates.map((entry) => ({
            id: entry.match!.id,
            type: entry.contract.type,
            end_date: entry.contract.endDate,
            notice_window: entry.contract.noticeWindow,
            status: entry.contract.status,
            template_id: entry.contract.templateId,
            template_name: entry.contract.templateId
              ? entry.contract.templateName
              : null,
            generated_text: entry.contract.templateId ? textFor(entry) : null,
          })),
        )}::jsonb) as v(id uuid, type text, end_date text, notice_window text, status text, template_id text, template_name text, generated_text text)
        where c.id = v.id and c.company_id = ${job.companyId}
      `);

      for (const entry of updates) {
        const before = entry.match!;

        marks.push({
          id: entry.row.id,
          targetPersonId: entry.personId,
          targetContractId: before.id,
          previous: {
            type: before.type,
            endDate: before.endDate,
            noticeWindow: before.noticeWindow,
            status: before.status,
            templateId: before.templateId,
            templateName: before.templateName,
            generatedText: before.generatedText,
            previousContractId: before.previousContractId,
          },
        });
        audit.push({
          companyId: job.companyId,
          actorUserId: job.actorUserId,
          resourceType: "contract",
          resourceId: before.id,
          action: "update",
          source: "import",
          payload: {
            summary: "Contrato actualizado por importación",
            changes: Object.fromEntries(
              Object.entries(entry.row.diff ?? {}).map(
                ([field, [from, to]]) => [field, { from, to }],
              ),
            ),
          },
        });
      }
    }

    await markRows(tx, job.companyId, marks);
    await tx.insert(auditEvents).values(audit);
    await tx
      .update(importJobs)
      .set({
        counts: sql`jsonb_set(${importJobs.counts}, '{applied}', to_jsonb(coalesce((${importJobs.counts}->>'applied')::int, 0) + ${marks.length}))`,
      })
      .where(
        and(eq(importJobs.companyId, job.companyId), eq(importJobs.id, job.id)),
      );

    return rows.length;
  });

/**
 * Chains contracts by start order per person (previous_contract_id), over the
 * person's whole history so imported and existing contracts link up. Idempotent.
 */
const applyContractChain = async (job: ImportJob) =>
  withTransaction(async (tx) => {
    await lockJob(tx, job.id);
    await tx.execute(sql`
      with imported as (
        select distinct target_contract_id as id, target_person_id as person_id
        from import_rows
        where company_id = ${job.companyId} and job_id = ${job.id} and sheet = 'contratos'
          and applied_at is not null and target_contract_id is not null
      ), ordered as (
        select c.id,
               lag(c.id) over (partition by c.person_id order by c.start_date, c.created_at, c.id) as prev
        from contracts c
        where c.deleted_at is null
          and c.company_id = ${job.companyId}
          and c.person_id in (select person_id from imported)
      )
      update contracts c set previous_contract_id = o.prev, updated_at = now()
      from ordered o
      where c.id = o.id
        and c.company_id = ${job.companyId}
        and c.id in (select id from imported)
        and c.previous_contract_id is distinct from o.prev
    `);
    await tx
      .update(importJobs)
      .set({
        counts: sql`${importJobs.counts} || '{"chainApplied": true}'::jsonb`,
      })
      .where(
        and(eq(importJobs.companyId, job.companyId), eq(importJobs.id, job.id)),
      );
  });

const countRemaining = async (
  companyId: string,
  jobId: string,
  sheet?: string,
) => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
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
    .where(
      and(
        eq(importJobs.companyId, job.companyId),
        eq(importJobs.id, job.id),
        eq(importJobs.status, "applying"),
      ),
    )
    .returning();

  if (done) {
    const counts = done.counts as ImportJobCounts;

    await recordAuditEvent({
      companyId: job.companyId,
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
export const applyJobStep = async (
  companyId: string,
  jobId: string,
): Promise<ApplyProgress> => {
  const [loaded] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.companyId, companyId), eq(importJobs.id, jobId)))
    .limit(1);

  if (!loaded) {
    throw new ImportBlockedError(
      "No encontramos esta importación.",
      "not_applicable",
    );
  }

  const job = await beginApply(loaded);

  try {
    if ((await countRemaining(companyId, jobId, "personas")) > 0) {
      await applyPersonasBatch(job);

      return progress("personas", companyId, jobId);
    }

    if (!job.counts.managersApplied) {
      await applyManagers(job);

      return progress("managers", companyId, jobId);
    }

    if ((await countRemaining(companyId, jobId, "horarios")) > 0) {
      await applyHorariosBatch(job);

      return progress("horarios", companyId, jobId);
    }

    if ((await countRemaining(companyId, jobId, "contratos")) > 0) {
      await applyContratosBatch(job);

      return progress("contratos", companyId, jobId);
    }

    if (!job.counts.chainApplied) {
      await applyContractChain(job);

      return progress("chain", companyId, jobId);
    }

    await finish(job);

    return progress("done", companyId, jobId);
  } catch (error) {
    // Keep the rows' state: the user can resume from "Continuar importación".
    await db
      .update(importJobs)
      .set({
        status: "failed",
        failureMessage: String((error as Error).message).slice(0, 500),
      })
      .where(
        and(
          eq(importJobs.companyId, companyId),
          eq(importJobs.id, jobId),
          eq(importJobs.status, "applying"),
        ),
      );

    throw error;
  }
};

const progress = async (
  phase: ApplyPhase,
  companyId: string,
  jobId: string,
): Promise<ApplyProgress> => {
  const [job] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.companyId, companyId), eq(importJobs.id, jobId)))
    .limit(1);
  const remaining = await countRemaining(companyId, jobId);

  return {
    phase,
    done: job?.status === "applied",
    applied: job?.counts.applied ?? 0,
    remaining,
  };
};

/** Releases the apply lock without losing progress. */
export const pauseApply = async (companyId: string, jobId: string) => {
  const [paused] = await db
    .update(importJobs)
    .set({ status: "failed", failureMessage: "Pausada por el usuario." })
    .where(
      and(
        eq(importJobs.companyId, companyId),
        eq(importJobs.id, jobId),
        eq(importJobs.status, "applying"),
      ),
    )
    .returning({ id: importJobs.id });

  return Boolean(paused);
};
