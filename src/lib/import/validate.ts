import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db, type DbExecutor } from "@/lib/db";
import {
  areas,
  importJobs,
  importRows,
  people,
  personSchedules,
  positions,
  sites,
  type ImportJobCounts,
  type ImportRowError,
} from "@/lib/db/schema";
import { contracts, contractTemplates } from "@/lib/db/schema";
import { identifierOrNull } from "@/lib/people/identity";

import {
  contractIdentity,
  diffContract,
  findContractFileConflicts,
  normalizeContractRow,
  personKeyOf,
  type ContractFileRow,
} from "./contract-rows";

import { catalogKey } from "./format";
import {
  classifyPersonRow,
  findFileDuplicates,
  findManagerCycleNodes,
  isUuid,
  normalizePersonRow,
  possibleDuplicateKey,
  type Cells,
  type KeyedRow,
  type PersonLookups,
} from "./person-rows";
import type {
  CatalogIndex,
  ExistingContract,
  ExistingPerson,
  NormalizedContract,
  ManagerRef,
  NormalizedPerson,
  RowOutcome,
} from "./types";

export const VALIDATE_CHUNK_SIZE = 500;

type RowUpdate = { id: string; outcome: RowOutcome };

type FileKey = KeyedRow & {
  id: string;
  action: RowOutcome["action"];
  targetPersonId: string | null;
};

const personColumns = {
  id: people.id,
  deletedAt: people.deletedAt,
  curp: people.curp,
  rfc: people.rfc,
  nombres: people.nombres,
  apellidoPaterno: people.apellidoPaterno,
  apellidoMaterno: people.apellidoMaterno,
  email: people.email,
  telefono: people.telefono,
  fechaNacimiento: people.fechaNacimiento,
  fechaIngreso: people.fechaIngreso,
  areaId: people.areaId,
  positionId: people.positionId,
  siteId: people.siteId,
  nss: people.nss,
  status: people.status,
  managerId: people.managerId,
};

export const loadCatalogIndex = async (
  companyId: string,
): Promise<CatalogIndex> => {
  const [areaRows, positionRows, siteRows] = await Promise.all([
    db
      .select({ id: areas.id, name: areas.name })
      .from(areas)
      .where(and(eq(areas.companyId, companyId), isNull(areas.deletedAt))),
    db
      .select({
        id: positions.id,
        name: positions.name,
        areaId: positions.areaId,
      })
      .from(positions)
      .where(
        and(eq(positions.companyId, companyId), isNull(positions.deletedAt)),
      ),
    db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.companyId, companyId), isNull(sites.deletedAt))),
  ]);
  const positionIndex: CatalogIndex["positions"] = new Map();

  for (const row of positionRows) {
    const key = catalogKey(row.name);

    positionIndex.set(key, [
      ...(positionIndex.get(key) ?? []),
      { id: row.id, areaId: row.areaId },
    ]);
  }

  return {
    areas: new Map(areaRows.map((row) => [catalogKey(row.name), row.id])),
    positions: positionIndex,
    sites: new Map(siteRows.map((row) => [catalogKey(row.name), row.id])),
  };
};

const str = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** ID/CURP/RFC of every Personas row in the job, for duplicates and managers. */
const loadFileKeys = async (companyId: string, jobId: string) => {
  const rows = await db
    .select({
      id: importRows.id,
      rowNumber: importRows.rowNumber,
      raw: importRows.raw,
      action: importRows.action,
      targetPersonId: importRows.targetPersonId,
    })
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importRows.jobId, jobId),
        eq(importRows.sheet, "personas"),
      ),
    )
    .orderBy(asc(importRows.rowNumber));

  return rows.map((row): FileKey => ({
    id: row.id,
    action: row.action,
    targetPersonId: row.targetPersonId,
    rowNumber: row.rowNumber,
    idWorkia: str(row.raw.idWorkia),
    curp: identifierOrNull(str(row.raw.curp)),
    rfc: identifierOrNull(str(row.raw.rfc)),
  }));
};

export const loadLookups = async (
  companyId: string,
  rows: KeyedRow[],
  executor: DbExecutor = db,
): Promise<PersonLookups> => {
  const ids = [
    ...new Set(
      rows.flatMap((r) =>
        r.idWorkia && isUuid(r.idWorkia) ? [r.idWorkia.toLowerCase()] : [],
      ),
    ),
  ];
  const curps = [...new Set(rows.flatMap((r) => (r.curp ? [r.curp] : [])))];
  const rfcs = [...new Set(rows.flatMap((r) => (r.rfc ? [r.rfc] : [])))];
  const lookups: PersonLookups = {
    byId: new Map(),
    byCurp: new Map(),
    byRfc: new Map(),
  };
  const conditions = [
    ids.length ? inArray(people.id, ids) : undefined,
    curps.length
      ? and(isNull(people.deletedAt), inArray(people.curp, curps))
      : undefined,
    rfcs.length
      ? and(isNull(people.deletedAt), inArray(people.rfc, rfcs))
      : undefined,
  ].filter((condition) => condition !== undefined);

  if (conditions.length === 0) {
    return lookups;
  }

  const found = (await executor
    .select(personColumns)
    .from(people)
    .where(
      and(eq(people.companyId, companyId), or(...conditions)),
    )) as ExistingPerson[];

  for (const person of found) {
    lookups.byId.set(person.id, person);

    if (!person.deletedAt) {
      if (person.curp) lookups.byCurp.set(person.curp, person);
      if (person.rfc) lookups.byRfc.set(person.rfc, person);
    }
  }

  return lookups;
};

/** Existing active people with the same name and birth date (one query). */
const loadPossibleDuplicates = async (
  companyId: string,
  keys: { nombres: string; apellidoPaterno: string; fechaNacimiento: string }[],
) => {
  if (keys.length === 0) {
    return new Set<string>();
  }

  const birthDates = [...new Set(keys.map((key) => key.fechaNacimiento))];
  const found = await db
    .select({
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      fechaNacimiento: people.fechaNacimiento,
    })
    .from(people)
    .where(
      and(
        eq(people.companyId, companyId),
        isNull(people.deletedAt),
        inArray(people.fechaNacimiento, birthDates),
      ),
    );

  return new Set(
    found.flatMap((person) => {
      const key = possibleDuplicateKey(person);

      return key ? [key] : [];
    }),
  );
};

/** One statement per chunk, not one per row. */
const saveOutcomes = async (companyId: string, updates: RowUpdate[]) => {
  if (updates.length === 0) {
    return;
  }

  const payload = updates.map(({ id, outcome }) => ({
    id,
    action: outcome.action,
    errors: outcome.errors.length ? outcome.errors : null,
    diff: outcome.diff,
    normalized: outcome.normalized,
    target_person_id: outcome.targetPersonId,
    target_contract_id: outcome.targetContractId ?? null,
  }));

  await db.execute(sql`
    update import_rows r set
      action = v.action::import_row_action,
      errors = v.errors,
      diff = v.diff,
      normalized = nullif(v.normalized, 'null'::jsonb),
      target_person_id = v.target_person_id,
      target_contract_id = v.target_contract_id
    from jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
      as v(id uuid, action text, errors jsonb, diff jsonb, normalized jsonb, target_person_id uuid, target_contract_id uuid)
    where r.id = v.id and r.company_id = ${companyId}
  `);
};

const errorOutcome = (errors: ImportRowError[]): RowOutcome => ({
  action: "error",
  errors,
  diff: null,
  targetPersonId: null,
  normalized: null,
});

export type ValidateProgress = {
  processed: number;
  remaining: number;
};

const countPending = async (
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
        eq(importRows.action, "pending"),
        sheet ? eq(importRows.sheet, sheet) : undefined,
      ),
    );

  return row?.count ?? 0;
};

/**
 * Validates the next chunk of pending Personas rows. Every chunk costs a fixed
 * number of queries (catalogs, file keys, matches, possible duplicates, one
 * bulk save), whatever its size.
 */
export const validatePersonasChunk = async (
  companyId: string,
  jobId: string,
  limit = VALIDATE_CHUNK_SIZE,
): Promise<ValidateProgress> => {
  const [job] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.companyId, companyId), eq(importJobs.id, jobId)))
    .limit(1);

  if (!job || job.status !== "validating") {
    throw new Error("La importación no está en validación.");
  }

  const pending = await db
    .select({
      id: importRows.id,
      rowNumber: importRows.rowNumber,
      raw: importRows.raw,
    })
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importRows.jobId, jobId),
        eq(importRows.sheet, "personas"),
        eq(importRows.action, "pending"),
      ),
    )
    .orderBy(asc(importRows.rowNumber))
    .limit(limit);

  if (pending.length === 0) {
    return { processed: 0, remaining: await countPending(companyId, jobId) };
  }

  const [catalogs, fileKeys] = await Promise.all([
    loadCatalogIndex(companyId),
    loadFileKeys(companyId, jobId),
  ]);
  const duplicates = findFileDuplicates(fileKeys);
  const chunkKeys = fileKeys.filter((key) =>
    pending.some((row) => row.id === key.id),
  );
  const lookups = await loadLookups(companyId, chunkKeys);
  const options = {
    createMissingCatalogs: job.options.createMissingCatalogs === true,
  };

  const updates: RowUpdate[] = [];
  const keyless: {
    update: RowUpdate;
    key: string;
    values: NormalizedPerson["values"];
  }[] = [];

  for (const row of pending) {
    const dup = duplicates.get(row.rowNumber);

    if (dup) {
      updates.push({ id: row.id, outcome: errorOutcome([dup]) });
      continue;
    }

    const { normalized, errors } = normalizePersonRow(
      row.raw as Cells,
      catalogs,
      options,
    );

    if (!normalized) {
      updates.push({ id: row.id, outcome: errorOutcome(errors) });
      continue;
    }

    const outcome = classifyPersonRow(normalized, lookups);
    const update = { id: row.id, outcome };

    updates.push(update);

    const hasKey =
      normalized.idWorkia || normalized.values.curp || normalized.values.rfc;
    const dobKey = possibleDuplicateKey(normalized.values);

    if (outcome.action === "create" && !hasKey && dobKey) {
      keyless.push({ update, key: dobKey, values: normalized.values });
    }
  }

  const possible = await loadPossibleDuplicates(
    companyId,
    keyless.map(({ values }) => ({
      nombres: values.nombres,
      apellidoPaterno: values.apellidoPaterno,
      fechaNacimiento: values.fechaNacimiento!,
    })),
  );

  for (const { update, key } of keyless) {
    if (possible.has(key)) {
      update.outcome.errors.push({
        severity: "warning",
        message:
          "Posible duplicado: ya existe una persona con el mismo nombre y fecha de nacimiento. Agrega CURP o ID Workia para actualizarla.",
      });
    }
  }

  await saveOutcomes(companyId, updates);

  return {
    processed: pending.length,
    remaining: await countPending(companyId, jobId),
  };
};

type PersonRow = {
  id: string;
  rowNumber: number;
  action: RowOutcome["action"];
  normalized: NormalizedPerson | null;
  diff: Record<string, [unknown, unknown]> | null;
  targetPersonId: string | null;
  errors: ImportRowError[] | null;
};

/**
 * Second pass: resolves each row's direct manager (a CURP/ID of another file
 * row or an existing person), rejects self-references, unknown managers and
 * cycles, and records the manager change in the row's diff.
 */
export const resolveManagers = async (companyId: string, jobId: string) => {
  const rows = (await db
    .select({
      id: importRows.id,
      rowNumber: importRows.rowNumber,
      action: importRows.action,
      normalized: importRows.normalized,
      diff: importRows.diff,
      targetPersonId: importRows.targetPersonId,
      errors: importRows.errors,
    })
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importRows.jobId, jobId),
        eq(importRows.sheet, "personas"),
      ),
    )) as unknown as PersonRow[];

  const withManager = rows.filter(
    (row) => row.action !== "error" && row.normalized?.managerInput,
  );

  if (withManager.length === 0) {
    return;
  }

  const fileByKey = new Map<string, PersonRow>();

  for (const row of rows) {
    const raw = row.normalized;

    if (!raw) continue;
    if (raw.idWorkia) fileByKey.set(`id:${raw.idWorkia.toLowerCase()}`, row);
    if (raw.values.curp) fileByKey.set(`curp:${raw.values.curp}`, row);
  }

  const inputs = withManager.map((row) => row.normalized!.managerInput!);
  const ids = inputs.filter(isUuid).map((value) => value.toLowerCase());
  const curps = inputs
    .filter((value) => !isUuid(value))
    .map((value) => identifierOrNull(value)!);
  const [existingManagers, links] = await Promise.all([
    ids.length || curps.length
      ? db
          .select({ id: people.id, curp: people.curp })
          .from(people)
          .where(
            and(
              eq(people.companyId, companyId),
              isNull(people.deletedAt),
              or(
                ids.length ? inArray(people.id, ids) : undefined,
                curps.length ? inArray(people.curp, curps) : undefined,
              ),
            ),
          )
      : Promise.resolve([] as { id: string; curp: string | null }[]),
    db
      .select({ id: people.id, managerId: people.managerId })
      .from(people)
      .where(and(eq(people.companyId, companyId), isNull(people.deletedAt))),
  ]);

  const existingById = new Map(existingManagers.map((p) => [p.id, p]));
  const existingByCurp = new Map(
    existingManagers.flatMap((p) => (p.curp ? [[p.curp, p] as const] : [])),
  );
  const currentManager = new Map(
    links.map((link) => [link.id, link.managerId]),
  );
  const nodeOf = (row: PersonRow) =>
    row.targetPersonId ?? `row:${row.rowNumber}`;
  const failed = new Map<string, ImportRowError>();
  const refs = new Map<string, ManagerRef>();
  const managerOf = new Map<string, string>(
    links.flatMap((link) =>
      link.managerId ? [[link.id, link.managerId] as const] : [],
    ),
  );

  for (const row of withManager) {
    const input = row.normalized!.managerInput!;
    const key = isUuid(input)
      ? `id:${input.toLowerCase()}`
      : `curp:${identifierOrNull(input)}`;
    const fileRow = fileByKey.get(key);
    let ref: ManagerRef | null = null;
    let message: string | null = null;

    if (fileRow) {
      if (fileRow.action === "error") {
        message = `El jefe directo (fila ${fileRow.rowNumber}) tiene errores.`;
      } else if (fileRow.targetPersonId) {
        ref = { type: "person", id: fileRow.targetPersonId };
      } else {
        ref = { type: "row", rowNumber: fileRow.rowNumber };
      }
    } else {
      const existing = isUuid(input)
        ? existingById.get(input.toLowerCase())
        : existingByCurp.get(identifierOrNull(input)!);

      if (existing) {
        ref = { type: "person", id: existing.id };
      } else {
        message = `No encontramos al jefe directo "${input}".`;
      }
    }

    const target =
      ref?.type === "person" ? ref.id : ref ? `row:${ref.rowNumber}` : null;

    if (target && target === nodeOf(row)) {
      message = "Una persona no puede ser su propio jefe directo.";
    }

    if (message || !ref || !target) {
      failed.set(row.id, {
        field: "jefeDirecto",
        message: message ?? "Jefe directo inválido.",
      });
    } else {
      refs.set(row.id, ref);
      managerOf.set(nodeOf(row), target);
    }
  }

  const inCycle = findManagerCycleNodes(managerOf);

  for (const row of withManager) {
    if (refs.has(row.id) && inCycle.has(nodeOf(row))) {
      refs.delete(row.id);
      failed.set(row.id, {
        field: "jefeDirecto",
        message: "El jefe directo forma un ciclo (A reporta a B y B a A).",
      });
    }
  }

  const updates: RowUpdate[] = [];

  for (const row of withManager) {
    const error = failed.get(row.id);

    if (error) {
      updates.push({ id: row.id, outcome: errorOutcome([error]) });
      continue;
    }

    const ref = refs.get(row.id)!;
    const normalized = { ...row.normalized!, managerRef: ref };
    const diff = { ...(row.diff ?? {}) };
    let action = row.action;
    const before = row.targetPersonId
      ? (currentManager.get(row.targetPersonId) ?? null)
      : null;
    const label = ref.type === "person" ? ref.id : `fila ${ref.rowNumber}`;

    if (row.targetPersonId && !(ref.type === "person" && ref.id === before)) {
      diff.managerId = [before, label];

      if (action === "unchanged") action = "update";
    }

    updates.push({
      id: row.id,
      outcome: {
        action,
        errors: (row.errors ?? []).filter((e) => e.field !== "jefeDirecto"),
        diff: Object.keys(diff).length ? diff : null,
        targetPersonId: row.targetPersonId,
        normalized,
      },
    });
  }

  await saveOutcomes(companyId, updates);
};

const TIME_FIELDS = [
  "entrada",
  "salidaComer",
  "regresoComer",
  "salida",
] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validates pending Horarios rows: person lookup, time format, diff. */
export const validateHorariosChunk = async (
  companyId: string,
  jobId: string,
  limit = VALIDATE_CHUNK_SIZE,
): Promise<ValidateProgress> => {
  const pending = await db
    .select({
      id: importRows.id,
      rowNumber: importRows.rowNumber,
      raw: importRows.raw,
    })
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importRows.jobId, jobId),
        eq(importRows.sheet, "horarios"),
        eq(importRows.action, "pending"),
      ),
    )
    .orderBy(asc(importRows.rowNumber))
    .limit(limit);

  if (pending.length === 0) {
    return {
      processed: 0,
      remaining: await countPending(companyId, jobId, "horarios"),
    };
  }

  const keys: KeyedRow[] = pending.map((row) => ({
    rowNumber: row.rowNumber,
    idWorkia: str(row.raw.idWorkia),
    curp: identifierOrNull(str(row.raw.curp)),
    rfc: null,
  }));
  const [lookups, fileKeys] = await Promise.all([
    loadLookups(companyId, keys),
    loadFileKeys(companyId, jobId),
  ]);
  const fileByCurp = new Map(
    fileKeys.flatMap((k) => (k.curp ? [[k.curp, k] as const] : [])),
  );
  const fileById = new Map(
    fileKeys.flatMap((k) =>
      k.idWorkia ? [[k.idWorkia.toLowerCase(), k] as const] : [],
    ),
  );
  const personIds = [
    ...lookups.byId.keys(),
    ...[...lookups.byCurp.values()].map((p) => p.id),
  ];
  const schedules = personIds.length
    ? await db
        .select()
        .from(personSchedules)
        .where(
          and(
            eq(personSchedules.companyId, companyId),
            inArray(personSchedules.personId, personIds),
            isNull(personSchedules.deletedAt),
          ),
        )
    : [];
  const scheduleByPerson = new Map(schedules.map((s) => [s.personId, s]));
  const updates: RowUpdate[] = [];

  for (const row of pending) {
    const idWorkia = str(row.raw.idWorkia);
    const curp = identifierOrNull(str(row.raw.curp));
    const errors: ImportRowError[] = [];
    const times: Record<string, string | null> = {};

    if (!idWorkia && !curp) {
      errors.push({
        field: "curp",
        message: "Indica el ID Workia o la CURP de la persona.",
      });
    }

    for (const field of TIME_FIELDS) {
      const value = str(row.raw[field]);

      times[field] = value;

      if (value && !TIME_RE.test(value)) {
        errors.push({ field, message: "Hora inválida (usa HH:MM, 24 horas)." });
      }
    }

    const person =
      (idWorkia && isUuid(idWorkia)
        ? lookups.byId.get(idWorkia.toLowerCase())
        : undefined) ?? (curp ? lookups.byCurp.get(curp) : undefined);
    const inFile =
      (idWorkia ? fileById.get(idWorkia.toLowerCase()) : undefined) ??
      (curp ? fileByCurp.get(curp) : undefined);

    if (errors.length === 0 && !person && !inFile) {
      errors.push({
        field: curp ? "curp" : "idWorkia",
        message: "No encontramos a la persona (ni en el archivo ni en Workia).",
      });
    }

    if (errors.length > 0) {
      updates.push({ id: row.id, outcome: errorOutcome(errors) });
      continue;
    }

    const normalized = { times } as unknown as NormalizedPerson;
    const current = person ? scheduleByPerson.get(person.id) : undefined;
    const diff: Record<string, [unknown, unknown]> = {};

    for (const field of TIME_FIELDS) {
      if (
        times[field] !== null &&
        times[field] !== (current?.[field] ?? null)
      ) {
        diff[field] = [current?.[field] ?? null, times[field]];
      }
    }

    const action = !current
      ? "create"
      : Object.keys(diff).length
        ? "update"
        : "unchanged";

    updates.push({
      id: row.id,
      outcome: {
        action,
        errors: [],
        diff: action === "update" ? diff : null,
        targetPersonId: person?.id ?? null,
        normalized,
      },
    });
  }

  await saveOutcomes(companyId, updates);

  return {
    processed: pending.length,
    remaining: await countPending(companyId, jobId, "horarios"),
  };
};

/** Validates pending Contratos rows: person, dates, status, template, one vigente. */
export const validateContratosChunk = async (
  companyId: string,
  jobId: string,
  limit = VALIDATE_CHUNK_SIZE,
): Promise<ValidateProgress> => {
  const pending = await db
    .select({
      id: importRows.id,
      rowNumber: importRows.rowNumber,
      raw: importRows.raw,
    })
    .from(importRows)
    .where(
      and(
        eq(importRows.companyId, companyId),
        eq(importRows.jobId, jobId),
        eq(importRows.sheet, "contratos"),
        eq(importRows.action, "pending"),
      ),
    )
    .orderBy(asc(importRows.rowNumber))
    .limit(limit);

  if (pending.length === 0) {
    return {
      processed: 0,
      remaining: await countPending(companyId, jobId, "contratos"),
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const [templateRows, allRows, fileKeys] = await Promise.all([
    db
      .select({ id: contractTemplates.id, name: contractTemplates.name })
      .from(contractTemplates)
      .where(
        and(
          eq(contractTemplates.companyId, companyId),
          isNull(contractTemplates.deletedAt),
        ),
      ),
    db
      .select({ rowNumber: importRows.rowNumber, raw: importRows.raw })
      .from(importRows)
      .where(
        and(
          eq(importRows.companyId, companyId),
          eq(importRows.jobId, jobId),
          eq(importRows.sheet, "contratos"),
        ),
      )
      .orderBy(asc(importRows.rowNumber)),
    loadFileKeys(companyId, jobId),
  ]);
  const templates = new Map(
    templateRows.map((t) => [catalogKey(t.name), { id: t.id, name: t.name }]),
  );

  // File-level rules need every contract row of the file, not just this chunk.
  const personOf = (cells: Cells) => {
    const key = personKeyOf(cells);

    return key.idWorkia?.toLowerCase() ?? key.curp;
  };
  const fileRows: ContractFileRow[] = allRows.map((row) => {
    const cells = row.raw as Cells;
    const { normalized } = normalizeContractRow(cells, { today, templates });

    return {
      rowNumber: row.rowNumber,
      person: personOf(cells),
      startDate: normalized?.startDate ?? null,
      status: normalized?.status ?? null,
    };
  });
  const conflicts = findContractFileConflicts(fileRows);
  const statusByPersonStart = new Map(
    fileRows.flatMap((row) =>
      row.person && row.startDate
        ? [[`${row.person}|${row.startDate}`, row.status] as const]
        : [],
    ),
  );

  const keys: KeyedRow[] = pending.map((row) => {
    const key = personKeyOf(row.raw as Cells);

    return {
      rowNumber: row.rowNumber,
      idWorkia: key.idWorkia,
      curp: key.curp,
      rfc: null,
    };
  });
  const lookups = await loadLookups(companyId, keys);
  const fileByCurp = new Map(
    fileKeys.flatMap((k) => (k.curp ? [[k.curp, k] as const] : [])),
  );
  const fileById = new Map(
    fileKeys.flatMap((k) =>
      k.idWorkia ? [[k.idWorkia.toLowerCase(), k] as const] : [],
    ),
  );
  const personIds = [
    ...new Set([
      ...lookups.byId.keys(),
      ...[...lookups.byCurp.values()].map((p) => p.id),
    ]),
  ];
  const existingContracts = (
    personIds.length
      ? await db
          .select({
            id: contracts.id,
            personId: contracts.personId,
            type: contracts.type,
            startDate: contracts.startDate,
            endDate: contracts.endDate,
            noticeWindow: contracts.noticeWindow,
            status: contracts.status,
            templateId: contracts.templateId,
            templateName: contracts.templateName,
          })
          .from(contracts)
          .where(
            and(
              eq(contracts.companyId, companyId),
              inArray(contracts.personId, personIds),
              isNull(contracts.deletedAt),
            ),
          )
      : []
  ) as ExistingContract[];
  const byIdentity = new Map(
    existingContracts.map((c) => [
      contractIdentity(c.personId, c.startDate),
      c,
    ]),
  );
  const vigenteByPerson = new Map<string, ExistingContract[]>();

  for (const contract of existingContracts) {
    if (contract.status === "vigente") {
      vigenteByPerson.set(contract.personId, [
        ...(vigenteByPerson.get(contract.personId) ?? []),
        contract,
      ]);
    }
  }

  const updates: RowUpdate[] = [];

  for (const row of pending) {
    const cells = row.raw as Cells;
    const conflict = conflicts.get(row.rowNumber);

    if (conflict) {
      updates.push({ id: row.id, outcome: errorOutcome([conflict]) });
      continue;
    }

    const { normalized, errors } = normalizeContractRow(cells, {
      today,
      templates,
    });

    if (!normalized) {
      updates.push({ id: row.id, outcome: errorOutcome(errors) });
      continue;
    }

    const { idWorkia, curp } = normalized.personKey;
    const inFile =
      (idWorkia ? fileById.get(idWorkia.toLowerCase()) : undefined) ??
      (curp ? fileByCurp.get(curp) : undefined);
    const existingPerson =
      (idWorkia ? lookups.byId.get(idWorkia.toLowerCase()) : undefined) ??
      (curp ? lookups.byCurp.get(curp) : undefined);
    const personId =
      inFile?.targetPersonId ?? (inFile ? null : (existingPerson?.id ?? null));

    if (inFile?.action === "error") {
      updates.push({
        id: row.id,
        outcome: errorOutcome([
          {
            field: "curp",
            message: `La persona (fila ${inFile.rowNumber} de Personas) tiene errores.`,
          },
        ]),
      });
      continue;
    }

    if (!inFile && !existingPerson) {
      updates.push({
        id: row.id,
        outcome: errorOutcome([
          {
            field: curp ? "curp" : "idWorkia",
            message:
              "No encontramos a la persona (ni en el archivo ni en Workia).",
          },
        ]),
      });
      continue;
    }

    const match = personId
      ? byIdentity.get(contractIdentity(personId, normalized.startDate))
      : undefined;

    if (normalized.status === "vigente" && personId) {
      const personKey = idWorkia?.toLowerCase() ?? curp;
      const blocking = (vigenteByPerson.get(personId) ?? []).find(
        (contract) => {
          if (contract.startDate === normalized.startDate) return false;

          // The other vigente contract is fine if this file moves it out of vigente.
          const replaced = statusByPersonStart.get(
            `${personKey}|${contract.startDate}`,
          );

          return !replaced || replaced === "vigente";
        },
      );

      if (blocking) {
        updates.push({
          id: row.id,
          outcome: errorOutcome([
            {
              field: "estatus",
              message:
                "La persona ya tiene un contrato vigente en Workia (inicio " +
                blocking.startDate +
                ").",
            },
          ]),
        });
        continue;
      }
    }

    const diff = match ? diffContract(normalized, match) : null;

    updates.push({
      id: row.id,
      outcome: {
        action: !match
          ? "create"
          : Object.keys(diff!).length
            ? "update"
            : "unchanged",
        errors,
        diff: match && Object.keys(diff!).length ? diff : null,
        targetPersonId: personId,
        targetContractId: match?.id ?? null,
        normalized: normalized as NormalizedContract,
      },
    });
  }

  await saveOutcomes(companyId, updates);

  return {
    processed: pending.length,
    remaining: await countPending(companyId, jobId, "contratos"),
  };
};

export const countJobRows = async (
  companyId: string,
  jobId: string,
): Promise<ImportJobCounts> => {
  const rows = await db
    .select({ action: importRows.action, count: sql<number>`count(*)::int` })
    .from(importRows)
    .where(
      and(eq(importRows.companyId, companyId), eq(importRows.jobId, jobId)),
    )
    .groupBy(importRows.action);
  const counts: ImportJobCounts = {};
  let total = 0;

  for (const row of rows) {
    if (row.action !== "pending") {
      counts[row.action] = row.count;
    }

    total += row.count;
  }

  counts.total = total;

  return counts;
};

/**
 * Advances validation by one step and, when every row is classified, runs the
 * manager pass and moves the job to review. The page calls this in a loop.
 */
export const validateJobStep = async (companyId: string, jobId: string) => {
  await validatePersonasChunk(companyId, jobId);

  const pendingPersonas = await countPending(companyId, jobId, "personas");

  if (pendingPersonas > 0) {
    return { done: false, remaining: await countPending(companyId, jobId) };
  }

  const horarios = await validateHorariosChunk(companyId, jobId);

  if (horarios.remaining > 0) {
    return { done: false, remaining: await countPending(companyId, jobId) };
  }

  await validateContratosChunk(companyId, jobId);

  if ((await countPending(companyId, jobId, "contratos")) > 0) {
    return { done: false, remaining: await countPending(companyId, jobId) };
  }

  await resolveManagers(companyId, jobId);

  const counts = await countJobRows(companyId, jobId);

  await db
    .update(importJobs)
    .set({ status: "in_review", counts })
    .where(
      and(
        eq(importJobs.companyId, companyId),
        eq(importJobs.id, jobId),
        eq(importJobs.status, "validating"),
      ),
    );

  return { done: true, remaining: 0, counts };
};

/** Back to pending, e.g. after changing the review options. */
export const restartValidation = async (
  companyId: string,
  jobId: string,
  options: {
    createMissingCatalogs?: boolean;
    mode?: "all_or_nothing" | "valid_only";
  },
) => {
  await db
    .update(importRows)
    .set({
      action: "pending",
      errors: null,
      diff: null,
      normalized: null,
      targetPersonId: null,
    })
    .where(
      and(eq(importRows.companyId, companyId), eq(importRows.jobId, jobId)),
    );
  await db
    .update(importJobs)
    .set({
      status: "validating",
      options: sql`${importJobs.options} || ${JSON.stringify(options)}::jsonb`,
    })
    .where(
      and(
        eq(importJobs.companyId, companyId),
        eq(importJobs.id, jobId),
        inArray(importJobs.status, ["in_review", "validating"]),
      ),
    );
};
