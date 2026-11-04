import { createHash, randomBytes } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { db, tdb, withTransaction } from "@/lib/db";
import { clampPageSize, defineKeyset, type KeysetPage } from "@/lib/db/keyset";
import {
  attendanceBadges,
  attendanceBatches,
  attendanceCheckinSites,
  attendanceDevices,
  attendanceUnmatched,
  people,
  sites,
  users,
} from "@/lib/db/schema";
import type {
  AttendanceCsvFormat,
  AttendanceQrMode,
} from "@/lib/db/schema/attendance";
import { formatPersonName } from "@/lib/people/schema";
import { withTenant } from "@/lib/tenant/scope";

import { normalizeBadge, readChecadorCsv } from "./csv-format";
import {
  ingestPunches,
  recomputeIncidenciasAfter,
  type IngestSummary,
} from "./ingest";

/**
 * HR's side of attendance ingestion (W2-12): checadores and their tokens,
 * CSV uploads, people's numbers, the unmatched report, and app check-in
 * points. Every write leaves an audit event; punches themselves go to the
 * person timeline (ingest.ts), never to audit.
 */

export const ATTENDANCE_COPY = {
  title: "Asistencia",
  description:
    "Checadas de los checadores y de la app: cargas, checadas sin persona, checadores y puntos de checado.",
  denied: "No tienes permiso para administrar la asistencia.",
  deviceName: "Escribe el nombre del checador (hasta 80 caracteres).",
  deviceNameTaken: "Ya hay un checador con ese nombre.",
  deviceMissing: "Ese checador no existe en esta empresa.",
  deviceInactive: "Ese checador está desactivado.",
  siteMissing: "Esa ubicación no existe en esta empresa.",
  personMissing: "Esa persona no existe en esta empresa.",
  badge:
    "Escribe el número de la persona en el checador (hasta 40 caracteres).",
  badgeTaken: (name: string) => `Ese número ya es de ${name}.`,
  fileMissing: "Elige el archivo que exportó el checador.",
  fileTooLarge: "El archivo puede pesar hasta 5 MB.",
  fileTooManyRows: "El archivo tiene demasiadas checadas; divídelo por días.",
  rowMissing: "Esa checada ya no está pendiente.",
  position:
    "Escribe la latitud y longitud del lugar (por ejemplo 19.4326, -99.1332).",
  radius: "El radio va de 25 a 2,000 metros.",
} as const;

export const MAX_CSV_BYTES = 5 * 1024 * 1024;

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** A device push token: shown once, stored as its SHA-256. */
const newDeviceToken = () => `wkc_${randomBytes(24).toString("base64url")}`;

export const newQrSecret = () => randomBytes(32).toString("base64url");

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  ((error as { code?: string }).code === "23505" ||
    isUniqueViolation((error as { cause?: unknown }).cause));

const siteInCompany = async (companyId: string, siteId: string) => {
  const [row] = await tdb(companyId)
    .select({ id: sites.id })
    .from(sites)
    .where(
      withTenant(
        sites,
        companyId,
        eq(sites.id, siteId),
        isNull(sites.deletedAt),
      ),
    )
    .limit(1);

  return Boolean(row);
};

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// ---------------------------------------------------------------- checadores

export const listAttendanceDevices = async (companyId: string) =>
  tdb(companyId)
    .select({
      id: attendanceDevices.id,
      name: attendanceDevices.name,
      siteId: attendanceDevices.siteId,
      siteName: sites.name,
      csvFormat: attendanceDevices.csvFormat,
      hasToken: sql<boolean>`${attendanceDevices.tokenHash} is not null`,
      tokenHint: attendanceDevices.tokenHint,
      active: attendanceDevices.active,
      lastPushAt: attendanceDevices.lastPushAt,
    })
    .from(attendanceDevices)
    .leftJoin(
      sites,
      and(
        eq(sites.companyId, attendanceDevices.companyId),
        eq(sites.id, attendanceDevices.siteId),
      ),
    )
    .where(withTenant(attendanceDevices, companyId))
    .orderBy(desc(attendanceDevices.active), asc(attendanceDevices.name));

export type AttendanceDeviceRow = Awaited<
  ReturnType<typeof listAttendanceDevices>
>[number];

export type DeviceInput = {
  name: string;
  siteId: string | null;
  csvFormat: AttendanceCsvFormat;
};

export const createAttendanceDevice = async (
  companyId: string,
  input: DeviceInput,
  actorUserId: string,
): Promise<Result<{ id: string }>> => {
  if (input.siteId && !(await siteInCompany(companyId, input.siteId))) {
    return { ok: false, error: ATTENDANCE_COPY.siteMissing };
  }

  try {
    return await withTransaction(async (tx) => {
      const [device] = await tx
        .insert(attendanceDevices)
        .values({
          companyId,
          name: input.name,
          siteId: input.siteId,
          csvFormat: input.csvFormat,
        })
        .returning({ id: attendanceDevices.id });

      await recordAuditEvent(
        {
          companyId,
          actorUserId,
          resourceType: "attendance_device",
          resourceId: device.id,
          action: "create",
          payload: { summary: `Checador «${input.name}»`, after: input },
        },
        tx,
      );

      return { ok: true as const, id: device.id };
    }, companyId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: ATTENDANCE_COPY.deviceNameTaken };
    }

    throw error;
  }
};

export const updateAttendanceDevice = async (
  companyId: string,
  deviceId: string,
  input: DeviceInput,
  actorUserId: string,
): Promise<Result> => {
  if (input.siteId && !(await siteInCompany(companyId, input.siteId))) {
    return { ok: false, error: ATTENDANCE_COPY.siteMissing };
  }

  try {
    return await withTransaction(async (tx) => {
      const [before] = await tx
        .select({
          name: attendanceDevices.name,
          siteId: attendanceDevices.siteId,
          csvFormat: attendanceDevices.csvFormat,
        })
        .from(attendanceDevices)
        .where(
          withTenant(
            attendanceDevices,
            companyId,
            eq(attendanceDevices.id, deviceId),
          ),
        )
        .limit(1);

      if (!before) {
        return { ok: false as const, error: ATTENDANCE_COPY.deviceMissing };
      }

      await tx
        .update(attendanceDevices)
        .set({
          name: input.name,
          siteId: input.siteId,
          csvFormat: input.csvFormat,
        })
        .where(
          withTenant(
            attendanceDevices,
            companyId,
            eq(attendanceDevices.id, deviceId),
          ),
        );

      await recordAuditEvent(
        {
          companyId,
          actorUserId,
          resourceType: "attendance_device",
          resourceId: deviceId,
          action: "update",
          payload: {
            summary: `Checador «${input.name}»`,
            before,
            after: input,
          },
        },
        tx,
      );

      return { ok: true as const };
    }, companyId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: ATTENDANCE_COPY.deviceNameTaken };
    }

    throw error;
  }
};

/**
 * Issues a new push token for an active checador, replacing the old one.
 * Returns it once; only its SHA-256 is kept.
 */
export const issueDeviceToken = async (
  companyId: string,
  deviceId: string,
  actorUserId: string,
): Promise<Result<{ token: string }>> => {
  const token = newDeviceToken();

  return withTransaction(async (tx) => {
    const [device] = await tx
      .update(attendanceDevices)
      .set({ tokenHash: sha256(token), tokenHint: token.slice(-4) })
      .where(
        withTenant(
          attendanceDevices,
          companyId,
          eq(attendanceDevices.id, deviceId),
          eq(attendanceDevices.active, true),
        ),
      )
      .returning({ name: attendanceDevices.name });

    if (!device) {
      return { ok: false as const, error: ATTENDANCE_COPY.deviceMissing };
    }

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "attendance_device",
        resourceId: deviceId,
        action: "activation_code",
        payload: { summary: `Token de envío del checador «${device.name}»` },
      },
      tx,
    );

    return { ok: true as const, token };
  }, companyId);
};

/** Turns a checador off or on. Off revokes its token. Its history stays. */
export const setAttendanceDeviceActive = async (
  companyId: string,
  deviceId: string,
  active: boolean,
  actorUserId: string,
): Promise<Result> =>
  withTransaction(async (tx) => {
    const [device] = await tx
      .update(attendanceDevices)
      .set(active ? { active } : { active, tokenHash: null, tokenHint: null })
      .where(
        withTenant(
          attendanceDevices,
          companyId,
          eq(attendanceDevices.id, deviceId),
        ),
      )
      .returning({ name: attendanceDevices.name });

    if (!device) {
      return { ok: false as const, error: ATTENDANCE_COPY.deviceMissing };
    }

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "attendance_device",
        resourceId: deviceId,
        action: active ? "activate" : "deactivate",
        payload: { summary: `Checador «${device.name}»` },
      },
      tx,
    );

    return { ok: true as const };
  }, companyId);

/**
 * The checador behind a push token, across companies (the token is the only
 * credential of /api/asistencia/checadas). Null when unknown or inactive.
 */
export const deviceForToken = async (token: string) => {
  if (!/^wkc_[A-Za-z0-9_-]{32}$/.test(token)) return null;

  const tokenHash = sha256(token);
  // The token is the only thing a push has: find its company outside RLS
  // (attendance_device_company, 0044), then read the checador under it.
  const found = await db.execute<{ company_id: string | null }>(
    sql`select attendance_device_company(${tokenHash}) as company_id`,
  );
  const companyId = found.rows[0]?.company_id ?? null;

  if (!companyId) return null;

  const [device] = await tdb(companyId)
    .select({
      id: attendanceDevices.id,
      companyId: attendanceDevices.companyId,
      siteId: attendanceDevices.siteId,
    })
    .from(attendanceDevices)
    .where(
      withTenant(
        attendanceDevices,
        companyId,
        eq(attendanceDevices.tokenHash, tokenHash),
        eq(attendanceDevices.active, true),
      ),
    )
    .limit(1);

  return device ?? null;
};

export const markDevicePush = async (
  companyId: string,
  deviceId: string,
  at: Date,
) =>
  tdb(companyId)
    .update(attendanceDevices)
    .set({ lastPushAt: at })
    .where(
      withTenant(
        attendanceDevices,
        companyId,
        eq(attendanceDevices.id, deviceId),
      ),
    );

// ---------------------------------------------------------------- uploads

const activeDevice = async (companyId: string, deviceId: string) => {
  const [device] = await tdb(companyId)
    .select({
      id: attendanceDevices.id,
      name: attendanceDevices.name,
      siteId: attendanceDevices.siteId,
      csvFormat: attendanceDevices.csvFormat,
      active: attendanceDevices.active,
    })
    .from(attendanceDevices)
    .where(
      withTenant(
        attendanceDevices,
        companyId,
        eq(attendanceDevices.id, deviceId),
      ),
    )
    .limit(1);

  return device ?? null;
};

/**
 * HR uploads a checador's export: read with the checador's format, then
 * ingested. Uploading the same file again adds nothing and lists nothing
 * twice.
 */
export const importChecadorCsv = async (
  companyId: string,
  input: { deviceId: string; fileName: string; text: string },
  actorUserId: string,
): Promise<Result<{ summary: IngestSummary }>> => {
  const device = await activeDevice(companyId, input.deviceId);

  if (!device) return { ok: false, error: ATTENDANCE_COPY.deviceMissing };
  if (!device.active)
    return { ok: false, error: ATTENDANCE_COPY.deviceInactive };

  const read = readChecadorCsv(input.text, device.csvFormat);

  if (read.punches.length > 20_000) {
    return { ok: false, error: ATTENDANCE_COPY.fileTooManyRows };
  }

  const summary = await withTransaction(async (tx) => {
    const result = await ingestPunches(
      companyId,
      {
        kind: "batch",
        source: "csv",
        deviceId: device.id,
        siteId: device.siteId,
        fileName: input.fileName,
        createdBy: actorUserId,
      },
      read.punches.map((punch) => ({
        line: punch.line,
        raw: punch.raw,
        badge: punch.badge,
        at: punch.at,
        kind: punch.kind,
      })),
      read.invalid,
      { rows: read.rows, tx },
    );

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "attendance_import",
        resourceId: result.batchId as string,
        action: "import",
        payload: {
          summary: `Checadas de «${device.name}» (${input.fileName.slice(0, 120)})`,
          after: {
            rows: result.rows,
            punchesAdded: result.punchesAdded,
            duplicates: result.duplicates,
            unmatched: result.unmatched,
            invalid: result.invalid,
          },
        },
      },
      tx,
    );

    return result;
  }, companyId);

  return { ok: true, summary };
};

const batchKeyset = defineKeyset([
  {
    column: attendanceBatches.createdAt,
    type: "timestamptz",
    direction: "desc",
  },
  { column: attendanceBatches.id, type: "uuid", direction: "desc" },
]);

/** Uploads and daily push totals, newest first. */
export const listAttendanceBatches = async (
  companyId: string,
  options: { cursor?: string | null; limit?: number } = {},
) => {
  const limit = clampPageSize(options.limit, 25, 100);
  const rows = await tdb(companyId)
    .select({
      id: attendanceBatches.id,
      source: attendanceBatches.source,
      pushDay: attendanceBatches.pushDay,
      fileName: attendanceBatches.fileName,
      deviceName: attendanceDevices.name,
      rows: attendanceBatches.rows,
      punchesAdded: attendanceBatches.punchesAdded,
      duplicates: attendanceBatches.duplicates,
      unmatched: attendanceBatches.unmatched,
      invalid: attendanceBatches.invalid,
      createdByName: users.name,
      createdAt: attendanceBatches.createdAt,
      updatedAt: attendanceBatches.updatedAt,
      cursor: batchKeyset.cursor,
    })
    .from(attendanceBatches)
    .innerJoin(
      attendanceDevices,
      and(
        eq(attendanceDevices.companyId, attendanceBatches.companyId),
        eq(attendanceDevices.id, attendanceBatches.deviceId),
      ),
    )
    .leftJoin(users, eq(users.id, attendanceBatches.createdBy))
    .where(
      withTenant(
        attendanceBatches,
        companyId,
        batchKeyset.after(options.cursor),
      ),
    )
    .orderBy(...batchKeyset.orderBy)
    .limit(limit + 1);

  return batchKeyset.page(rows, limit);
};

export type AttendanceBatchRow = Awaited<
  ReturnType<typeof listAttendanceBatches>
>["items"][number];

// ---------------------------------------------------------------- unmatched

const unmatchedKeyset = defineKeyset([
  {
    column: attendanceUnmatched.createdAt,
    type: "timestamptz",
    direction: "desc",
  },
  { column: attendanceUnmatched.id, type: "uuid", direction: "desc" },
]);

/** Punches still waiting for HR, newest first, with the raw row. */
export const listOpenUnmatched = async (
  companyId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<
  KeysetPage<{
    id: string;
    reason: "unknown_badge" | "invalid_row";
    line: number;
    badge: string | null;
    punchedAt: Date | null;
    kind: string | null;
    raw: string[];
    deviceName: string;
    createdAt: Date;
  }>
> => {
  const limit = clampPageSize(options.limit, 50, 200);
  const rows = await tdb(companyId)
    .select({
      id: attendanceUnmatched.id,
      reason: attendanceUnmatched.reason,
      line: attendanceUnmatched.line,
      badge: attendanceUnmatched.badge,
      punchedAt: attendanceUnmatched.punchedAt,
      kind: attendanceUnmatched.kind,
      raw: attendanceUnmatched.raw,
      deviceName: attendanceDevices.name,
      createdAt: attendanceUnmatched.createdAt,
      cursor: unmatchedKeyset.cursor,
    })
    .from(attendanceUnmatched)
    .innerJoin(
      attendanceDevices,
      and(
        eq(attendanceDevices.companyId, attendanceUnmatched.companyId),
        eq(attendanceDevices.id, attendanceUnmatched.deviceId),
      ),
    )
    .where(
      withTenant(
        attendanceUnmatched,
        companyId,
        isNull(attendanceUnmatched.resolvedAt),
        unmatchedKeyset.after(options.cursor),
      ),
    )
    .orderBy(...unmatchedKeyset.orderBy)
    .limit(limit + 1);

  return unmatchedKeyset.page(rows, limit);
};

export const countOpenUnmatched = async (companyId: string) => {
  const [row] = await tdb(companyId)
    .select({ total: sql<number>`count(*)::int` })
    .from(attendanceUnmatched)
    .where(
      withTenant(
        attendanceUnmatched,
        companyId,
        isNull(attendanceUnmatched.resolvedAt),
      ),
    );

  return row?.total ?? 0;
};

/**
 * Gives a number to a person and ingests every open punch that was waiting
 * on it, then marks those rows resolved. One transaction: the number, the
 * punches and the report change together.
 */
export const assignBadge = async (
  companyId: string,
  input: { badge: string; personId: string },
  actorUserId: string,
): Promise<Result<{ placed: number }>> => {
  const badge = normalizeBadge(input.badge);

  if (!badge || badge.length > 40)
    return { ok: false, error: ATTENDANCE_COPY.badge };

  const [person] = await tdb(companyId)
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
        eq(people.id, input.personId),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);

  if (!person) return { ok: false, error: ATTENDANCE_COPY.personMissing };

  const [taken] = await tdb(companyId)
    .select({
      personId: attendanceBadges.personId,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(attendanceBadges)
    .innerJoin(
      people,
      and(
        eq(people.companyId, attendanceBadges.companyId),
        eq(people.id, attendanceBadges.personId),
      ),
    )
    .where(
      withTenant(
        attendanceBadges,
        companyId,
        eq(attendanceBadges.badge, badge),
      ),
    )
    .limit(1);

  if (taken) {
    return {
      ok: false,
      error: ATTENDANCE_COPY.badgeTaken(formatPersonName(taken)),
    };
  }

  const touched: Array<{ personId: string; day: string }> = [];

  try {
    const result = await withTransaction(async (tx) => {
      await tx
        .insert(attendanceBadges)
        .values({ companyId, personId: person.id, badge });

      const waiting = await tx
        .select({
          id: attendanceUnmatched.id,
          deviceId: attendanceUnmatched.deviceId,
          line: attendanceUnmatched.line,
          raw: attendanceUnmatched.raw,
          punchedAt: attendanceUnmatched.punchedAt,
          kind: attendanceUnmatched.kind,
          siteId: attendanceDevices.siteId,
        })
        .from(attendanceUnmatched)
        .innerJoin(
          attendanceDevices,
          and(
            eq(attendanceDevices.companyId, attendanceUnmatched.companyId),
            eq(attendanceDevices.id, attendanceUnmatched.deviceId),
          ),
        )
        .where(
          withTenant(
            attendanceUnmatched,
            companyId,
            isNull(attendanceUnmatched.resolvedAt),
            eq(attendanceUnmatched.reason, "unknown_badge"),
            eq(attendanceUnmatched.badge, badge),
            isNotNull(attendanceUnmatched.punchedAt),
          ),
        );

      // Each checador keeps its own site and device id on the punch.
      const byDevice = new Map<string, typeof waiting>();

      for (const row of waiting) {
        byDevice.set(row.deviceId, [
          ...(byDevice.get(row.deviceId) ?? []),
          row,
        ]);
      }

      for (const [deviceId, rows] of byDevice) {
        await ingestPunches(
          companyId,
          { kind: "batch", source: "csv", deviceId, siteId: rows[0].siteId },
          rows.map((row) => ({
            line: row.line,
            raw: row.raw,
            badge: null,
            personId: person.id,
            at: row.punchedAt as Date,
            kind: row.kind === "in" || row.kind === "out" ? row.kind : null,
          })),
          [],
          { tx, recordBatch: false, touched },
        );
      }

      if (waiting.length > 0) {
        await tx
          .update(attendanceUnmatched)
          .set({ resolvedAt: new Date(), resolvedBy: actorUserId })
          .where(
            withTenant(
              attendanceUnmatched,
              companyId,
              inArray(
                attendanceUnmatched.id,
                waiting.map((row) => row.id),
              ),
            ),
          );
      }

      await recordAuditEvent(
        {
          companyId,
          actorUserId,
          resourceType: "attendance_badge",
          resourceId: person.id,
          action: "link",
          payload: {
            summary: `Número ${badge} para ${formatPersonName(person)}`,
            after: { badge, placed: waiting.length },
          },
        },
        tx,
      );

      return { ok: true as const, placed: waiting.length };
    }, companyId);

    await recomputeIncidenciasAfter(companyId, touched, new Date());

    return result;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: ATTENDANCE_COPY.badgeTaken("otra persona") };
    }

    throw error;
  }
};

/** Takes a number away from a person. Their stored punches stay. */
export const removeBadge = async (
  companyId: string,
  badgeId: string,
  actorUserId: string,
): Promise<Result> =>
  withTransaction(async (tx) => {
    const [removed] = await tx
      .delete(attendanceBadges)
      .where(
        withTenant(
          attendanceBadges,
          companyId,
          eq(attendanceBadges.id, badgeId),
        ),
      )
      .returning({
        badge: attendanceBadges.badge,
        personId: attendanceBadges.personId,
      });

    if (!removed) return { ok: false as const, error: ATTENDANCE_COPY.badge };

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "attendance_badge",
        resourceId: removed.personId,
        action: "unlink",
        payload: {
          summary: `Número ${removed.badge}`,
          before: { badge: removed.badge },
        },
      },
      tx,
    );

    return { ok: true as const };
  }, companyId);

/** HR says an unmatched row is not a punch to keep (a test, a visitor, a typo). */
export const dismissUnmatched = async (
  companyId: string,
  unmatchedId: string,
  actorUserId: string,
): Promise<Result> =>
  withTransaction(async (tx) => {
    const [row] = await tx
      .update(attendanceUnmatched)
      .set({ resolvedAt: new Date(), resolvedBy: actorUserId })
      .where(
        withTenant(
          attendanceUnmatched,
          companyId,
          eq(attendanceUnmatched.id, unmatchedId),
          isNull(attendanceUnmatched.resolvedAt),
        ),
      )
      .returning({
        batchId: attendanceUnmatched.batchId,
        line: attendanceUnmatched.line,
        badge: attendanceUnmatched.badge,
      });

    if (!row) return { ok: false as const, error: ATTENDANCE_COPY.rowMissing };

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "attendance_import",
        resourceId: row.batchId,
        action: "reject",
        payload: {
          summary: `Checada descartada (línea ${row.line}${row.badge ? `, número ${row.badge}` : ""})`,
        },
      },
      tx,
    );

    return { ok: true as const };
  }, companyId);

const badgeKeyset = defineKeyset([
  { column: attendanceBadges.badge, type: "text" },
  { column: attendanceBadges.id, type: "uuid" },
]);

/** People's numbers, by number. */
export const listBadges = async (
  companyId: string,
  options: { cursor?: string | null; limit?: number } = {},
) => {
  const limit = clampPageSize(options.limit, 50, 200);
  const rows = await tdb(companyId)
    .select({
      id: attendanceBadges.id,
      badge: attendanceBadges.badge,
      personId: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      cursor: badgeKeyset.cursor,
    })
    .from(attendanceBadges)
    .innerJoin(
      people,
      and(
        eq(people.companyId, attendanceBadges.companyId),
        eq(people.id, attendanceBadges.personId),
      ),
    )
    .where(
      withTenant(
        attendanceBadges,
        companyId,
        badgeKeyset.after(options.cursor),
      ),
    )
    .orderBy(...badgeKeyset.orderBy)
    .limit(limit + 1);

  return badgeKeyset.page(rows, limit);
};

// ---------------------------------------------------------------- app check-in points

export const listCheckinSites = async (companyId: string) =>
  tdb(companyId)
    .select({
      siteId: sites.id,
      siteName: sites.name,
      latitude: attendanceCheckinSites.latitude,
      longitude: attendanceCheckinSites.longitude,
      radiusMeters: attendanceCheckinSites.radiusMeters,
      qrMode: attendanceCheckinSites.qrMode,
      enabled: attendanceCheckinSites.enabled,
    })
    .from(sites)
    .leftJoin(
      attendanceCheckinSites,
      and(
        eq(attendanceCheckinSites.companyId, sites.companyId),
        eq(attendanceCheckinSites.siteId, sites.id),
      ),
    )
    .where(withTenant(sites, companyId, isNull(sites.deletedAt)))
    .orderBy(asc(sites.name));

export type CheckinSiteRow = Awaited<
  ReturnType<typeof listCheckinSites>
>[number];

export type CheckinSiteInput = {
  siteId: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  qrMode: AttendanceQrMode;
  enabled: boolean;
};

/** Sets up (or changes) app check-in at a site. The QR secret is made once. */
export const saveCheckinSite = async (
  companyId: string,
  input: CheckinSiteInput,
  actorUserId: string,
): Promise<Result> => {
  if (!(await siteInCompany(companyId, input.siteId))) {
    return { ok: false, error: ATTENDANCE_COPY.siteMissing };
  }

  return withTransaction(async (tx) => {
    const values = {
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      qrMode: input.qrMode,
      enabled: input.enabled,
    };

    await tx
      .insert(attendanceCheckinSites)
      .values({
        companyId,
        siteId: input.siteId,
        qrSecret: newQrSecret(),
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          attendanceCheckinSites.companyId,
          attendanceCheckinSites.siteId,
        ],
        set: values,
      });

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "attendance_checkin",
        resourceId: input.siteId,
        action: "update",
        payload: { summary: "Checado en la app", after: values },
      },
      tx,
    );

    return { ok: true as const };
  }, companyId);
};

/** A new QR secret: every code shown or printed before stops working. */
export const rotateCheckinSecret = async (
  companyId: string,
  siteId: string,
  actorUserId: string,
): Promise<Result> =>
  withTransaction(async (tx) => {
    const [row] = await tx
      .update(attendanceCheckinSites)
      .set({ qrSecret: newQrSecret() })
      .where(
        withTenant(
          attendanceCheckinSites,
          companyId,
          eq(attendanceCheckinSites.siteId, siteId),
        ),
      )
      .returning({ siteId: attendanceCheckinSites.siteId });

    if (!row) return { ok: false as const, error: ATTENDANCE_COPY.siteMissing };

    await recordAuditEvent(
      {
        companyId,
        actorUserId,
        resourceType: "attendance_checkin",
        resourceId: siteId,
        action: "revoke",
        payload: { summary: "Códigos QR anteriores invalidados" },
      },
      tx,
    );

    return { ok: true as const };
  }, companyId);
