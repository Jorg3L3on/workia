import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";

import { db, tdb, withTransaction } from "@/lib/db";
import {
  companies,
  lftAlertRuns,
  lftAlerts,
  people,
  type LftAlertKind,
} from "@/lib/db/schema";
import type { PermissionSlug } from "@/lib/db/schema/types";
import { listRenewalTrayItems } from "@/lib/contracts";
import { listExpiringDocuments } from "@/lib/documents";
import { isoToday } from "@/lib/format/date";
import { addDays } from "@/lib/incidencias/days";
import { runIncidencias } from "@/lib/incidencias";
import { logger } from "@/lib/logger";
import {
  createNotifications,
  hrRecipientsWithPermission,
  managerRecipientOf,
  sendNotificationsSoon,
  type NotificationRecipient,
  type TemplateData,
} from "@/lib/notifications";
import { PayPeriodError, quincenaOf } from "@/lib/pay-periods/quincena";
import { formatPersonName } from "@/lib/people/schema";
import { unjustifiedFaltaDays } from "@/lib/timeline/aggregates";
import { withTenant } from "@/lib/tenant/scope";

import {
  ABSENCE_WARNING_COUNT,
  ABSENCE_WINDOW_DAYS,
  detectAbsenceAlerts,
  type AbsenceLevel,
} from "./rules";

export * from "./rules";
export {
  LFT_ABSENCE_RULE,
  LFT_ALERT_KIND_LABEL,
  LFT_ALERTS_COPY,
} from "./copy";

/**
 * LFT alerts (Workia 2.0 W2-19, docs/alertas-lft.md). Three checks, each
 * read from what Workia already keeps:
 *
 * - absences: the unjustified faltas of the incidencias engine (W2-14), at
 *   three in 30 days (early warning) and at more than three (LFT art. 47-X);
 * - contracts: the renewal tray's contracts that end in 30 days or less;
 * - documents: the «Documentos por vencer» tray (30 days).
 *
 * Each alert goes to HR (the users with the check's permission) and to the
 * person's live manager through the W2-08 notifications, and is logged in
 * lft_alerts in the same transaction. The same fact is alerted once.
 */

export type LftAlertCheck = "absences" | "contracts" | "documents";

export const LFT_ALERT_CHECKS: readonly LftAlertCheck[] = [
  "absences",
  "contracts",
  "documents",
];

/** How far ahead a contract end or a document expiry is alerted. */
export const LFT_ALERT_LEAD_DAYS = 30;

/** The HR app runs the checks at most this often (see runLftAlertsIfDue). */
export const ALERT_RUN_INTERVAL_HOURS = 20;

/** Who in HR hears about each kind, and who can read it in the log. */
export const LFT_ALERT_PERMISSIONS: Record<
  LftAlertKind,
  { notify: PermissionSlug; read: PermissionSlug }
> = {
  absence_warning: { notify: "pay_periods:read", read: "pay_periods:read" },
  absence_threshold: { notify: "pay_periods:read", read: "pay_periods:read" },
  contract_ending: { notify: "contracts:update", read: "contracts:read" },
  document_expiring: { notify: "documents:manage", read: "documents:read" },
};

/** An alert to log and send; `kind` is also its notification template. */
type AlertDraft =
  | (DraftBase & { kind: AbsenceLevel; data: TemplateData["absence_warning"] })
  | (DraftBase & {
      kind: "contract_ending";
      data: TemplateData["contract_ending"];
    })
  | (DraftBase & {
      kind: "document_expiring";
      data: TemplateData["document_expiring"];
    });

type DraftBase = {
  personId: string;
  subjectKey: string;
  dueOn: string;
  details: Record<string, unknown>;
};

export type LftAlertRunResult = {
  /** New alerts logged and sent. */
  sent: number;
  byKind: Record<LftAlertKind, number>;
};

const emptyResult = (): LftAlertRunResult => ({
  sent: 0,
  byKind: {
    absence_warning: 0,
    absence_threshold: 0,
    contract_ending: 0,
    document_expiring: 0,
  },
});

const ABSENCE_KINDS: AbsenceLevel[] = ["absence_warning", "absence_threshold"];

/** Active, not deleted people among `ids`, with their display name. */
const activeNames = async (companyId: string, ids: string[]) => {
  if (ids.length === 0) return new Map<string, string>();

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
        inArray(people.id, ids),
        eq(people.status, "activa"),
        isNull(people.deletedAt),
      ),
    );

  return new Map(rows.map((row) => [row.id, formatPersonName(row)]));
};

// ---------------------------------------------------------------- checks

/**
 * The absence alerts due on `today`: the unjustified faltas of the last 60
 * days (so a falta of the last 30 days is counted with the 29 days before
 * it) and the absence alerts already sent. Only people with at least three
 * faltas are looked at further.
 */
const absenceDrafts = async (
  companyId: string,
  today: string,
  personIds?: string[],
): Promise<AlertDraft[]> => {
  const fromDay = addDays(today, -(ABSENCE_WINDOW_DAYS - 1));
  const faltas = await unjustifiedFaltaDays(
    companyId,
    { from: addDays(fromDay, -(ABSENCE_WINDOW_DAYS - 1)), to: today },
    { personIds },
  );
  const byPerson = new Map<string, string[]>();

  for (const { personId, day } of faltas) {
    byPerson.set(personId, [...(byPerson.get(personId) ?? []), day]);
  }

  const candidates = [...byPerson].filter(
    ([, days]) => days.length >= ABSENCE_WARNING_COUNT,
  );

  if (candidates.length === 0) return [];

  const ids = candidates.map(([personId]) => personId);
  const [names, prior] = await Promise.all([
    activeNames(companyId, ids),
    tdb(companyId)
      .select({
        personId: lftAlerts.personId,
        kind: lftAlerts.kind,
        dueOn: lftAlerts.dueOn,
      })
      .from(lftAlerts)
      .where(
        withTenant(
          lftAlerts,
          companyId,
          inArray(lftAlerts.personId, ids),
          inArray(lftAlerts.kind, ABSENCE_KINDS),
          gte(lftAlerts.dueOn, addDays(fromDay, -ABSENCE_WINDOW_DAYS)),
        ),
      ),
  ]);

  return candidates.flatMap(([personId, days]) => {
    const personName = names.get(personId);

    if (!personName) return [];

    const sent = prior
      .filter((row) => row.personId === personId)
      .map((row) => ({
        level: row.kind as AbsenceLevel,
        triggerDay: row.dueOn,
      }));

    return detectAbsenceAlerts(days, sent, fromDay).map((alert): AlertDraft => {
      const data = {
        personId,
        personName,
        count: alert.days.length,
        from: alert.windowFrom,
        to: alert.triggerDay,
      };

      return {
        kind: alert.level,
        personId,
        subjectKey: alert.triggerDay,
        dueOn: alert.triggerDay,
        details: { ...data, days: alert.days },
        data,
      };
    });
  });
};

/** The renewal tray's contracts that end within LFT_ALERT_LEAD_DAYS. */
const contractDrafts = async (
  companyId: string,
  today: string,
  personIds?: string[],
): Promise<AlertDraft[]> => {
  const until = addDays(today, LFT_ALERT_LEAD_DAYS);
  const items = await listRenewalTrayItems(companyId, today);

  return items
    .filter((item) => item.endDate >= today && item.endDate <= until)
    .filter((item) => !personIds || personIds.includes(item.personId))
    .map((item) => {
      const data = {
        personId: item.personId,
        personName: item.personName,
        endDate: item.endDate,
      };

      return {
        kind: "contract_ending" as const,
        personId: item.personId,
        subjectKey: `${item.contract.id}:${item.endDate}`,
        dueOn: item.endDate,
        details: { ...data, contractId: item.contract.id },
        data,
      };
    });
};

/** The «Documentos por vencer» tray: latest deliveries expiring in 30 days. */
const documentDrafts = async (
  companyId: string,
  today: string,
  personIds?: string[],
): Promise<AlertDraft[]> => {
  const until = addDays(today, LFT_ALERT_LEAD_DAYS);
  const rows = await listExpiringDocuments(companyId, today);

  return rows
    .filter((row) => row.expiresOn >= today && row.expiresOn <= until)
    .filter((row) => !personIds || personIds.includes(row.personId))
    .map((row) => {
      const data = {
        personId: row.personId,
        personName: row.personName,
        document: row.requirementName,
        expiresOn: row.expiresOn,
      };

      return {
        kind: "document_expiring" as const,
        personId: row.personId,
        subjectKey: `${row.id}:${row.expiresOn}`,
        dueOn: row.expiresOn,
        details: { ...data, documentId: row.id },
        data,
      };
    });
};

// ---------------------------------------------------------------- delivery

/**
 * Logs and sends the drafts not alerted before: per alert, the lft_alerts
 * row and its notifications (HR + manager) in one transaction, so an alert
 * is never logged without its messages nor sent twice.
 */
const deliver = async (
  companyId: string,
  drafts: AlertDraft[],
): Promise<LftAlertRunResult> => {
  const result = emptyResult();

  if (drafts.length === 0) return result;

  const hrByPermission = new Map<PermissionSlug, NotificationRecipient[]>();
  const managers = new Map<string, NotificationRecipient | null>();

  for (const draft of drafts) {
    const permission = LFT_ALERT_PERMISSIONS[draft.kind].notify;

    if (!hrByPermission.has(permission)) {
      hrByPermission.set(
        permission,
        await hrRecipientsWithPermission(companyId, permission),
      );
    }

    if (!managers.has(draft.personId)) {
      managers.set(
        draft.personId,
        await managerRecipientOf(companyId, draft.personId),
      );
    }
  }

  await withTransaction(async (tx) => {
    for (const draft of drafts) {
      const hr = hrByPermission.get(LFT_ALERT_PERMISSIONS[draft.kind].notify)!;
      const manager = managers.get(draft.personId) ?? null;
      const [logged] = await tx
        .insert(lftAlerts)
        .values({
          companyId,
          personId: draft.personId,
          kind: draft.kind,
          subjectKey: draft.subjectKey,
          dueOn: draft.dueOn,
          details: draft.details,
          hrRecipients: hr.length,
          managerNotified: manager !== null,
        })
        .onConflictDoNothing({
          target: [lftAlerts.companyId, lftAlerts.kind, lftAlerts.subjectKey],
        })
        .returning({ id: lftAlerts.id });

      if (!logged) continue;

      await createNotifications(
        companyId,
        {
          template: draft.kind,
          data: draft.data,
          recipients: manager ? [...hr, manager] : hr,
          eventKey: `lft_alert:${logged.id}`,
        } as Parameters<typeof createNotifications>[1],
        tx,
      );

      result.sent += 1;
      result.byKind[draft.kind] += 1;
    }
  }, companyId);

  if (result.sent > 0) {
    await sendNotificationsSoon(companyId);
  }

  return result;
};

/**
 * Runs the LFT checks for a company and sends the new alerts. `today` is the
 * company's calendar day (isoToday()); `personIds` narrows every check to
 * those people (after an ingestion); `checks` picks which run.
 */
export const runLftAlerts = async (
  companyId: string,
  options: {
    today?: string;
    personIds?: string[];
    checks?: readonly LftAlertCheck[];
  } = {},
): Promise<LftAlertRunResult> => {
  const today = options.today ?? isoToday();
  const checks = new Set(options.checks ?? LFT_ALERT_CHECKS);

  if (options.personIds && options.personIds.length === 0) {
    return emptyResult();
  }

  const drafts = [
    ...(checks.has("absences")
      ? await absenceDrafts(companyId, today, options.personIds)
      : []),
    ...(checks.has("contracts")
      ? await contractDrafts(companyId, today, options.personIds)
      : []),
    ...(checks.has("documents")
      ? await documentDrafts(companyId, today, options.personIds)
      : []),
  ];

  return deliver(companyId, drafts);
};

/**
 * The daily run, without a cron: the HR home calls it after its response,
 * and it does the work at most once every ALERT_RUN_INTERVAL_HOURS per
 * company (the claim is one upsert, so two tabs never both run it). It first
 * recomputes the incidencias of the running quincena and the one before
 * (open ones only), so a person who never punched has their faltas counted,
 * then runs every check. Returns null when it was not due.
 */
export const runLftAlertsIfDue = async (
  companyId: string,
  now: Date = new Date(),
): Promise<LftAlertRunResult | null> => {
  const dueBefore = new Date(
    now.getTime() - ALERT_RUN_INTERVAL_HOURS * 3_600_000,
  );
  const [claimed] = await withTransaction(
    (tx) =>
      tx
        .insert(lftAlertRuns)
        .values({ companyId, lastRunAt: now })
        .onConflictDoUpdate({
          target: lftAlertRuns.companyId,
          set: { lastRunAt: now },
          setWhere: lt(lftAlertRuns.lastRunAt, dueBefore),
        })
        .returning({ companyId: lftAlertRuns.companyId }),
    companyId,
  );

  if (!claimed) return null;

  const today = isoToday(now);
  const current = quincenaOf(today);
  const previous = quincenaOf(addDays(today, -16));

  for (const period of [...new Set([previous, current])]) {
    try {
      await runIncidencias(companyId, period, { asOf: now });
    } catch (error) {
      if (!(error instanceof PayPeriodError)) throw error;
    }
  }

  return runLftAlerts(companyId, { today });
};

/**
 * The absence check on its own, after the incidencias changed: new punches
 * (only the people they touched), a recompute or a close of a quincena. A
 * failure is logged and never undoes what called it; the daily run checks
 * again.
 */
export const alertAbsences = async (
  companyId: string,
  options: { personIds?: string[]; now?: Date } = {},
) => {
  try {
    return await runLftAlerts(companyId, {
      today: isoToday(options.now),
      personIds: options.personIds && [...new Set(options.personIds)],
      checks: ["absences"],
    });
  } catch (error) {
    logger.error(
      { event: "lft_alerts.absences_failed", companyId, err: error },
      "lft_alerts.absences_failed",
    );
    return null;
  }
};

/** Every company, for the optional scheduled route (/api/cron/lft-alerts). */
export const runLftAlertsForAllCompanies = async (now: Date = new Date()) => {
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .orderBy(asc(companies.createdAt));
  let ran = 0;
  let sent = 0;

  for (const { id } of rows) {
    try {
      const result = await runLftAlertsIfDue(id, now);

      if (result) {
        ran += 1;
        sent += result.sent;
      }
    } catch (error) {
      logger.error(
        { event: "lft_alerts.company_failed", companyId: id, err: error },
        "lft_alerts.company_failed",
      );
    }
  }

  return { companies: ran, sent };
};

// ---------------------------------------------------------------- the log

export const LFT_ALERTS_PAGE_SIZE = 30;

export type LftAlertLogItem = {
  id: string;
  kind: LftAlertKind;
  personId: string;
  personName: string;
  dueOn: string;
  details: Record<string, unknown>;
  hrRecipients: number;
  managerNotified: boolean;
  createdAt: Date;
};

const encodeCursor = (row: { createdAt: Date; id: string }) =>
  Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString("base64url");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const decodeCursor = (cursor: string | null | undefined) => {
  if (!cursor) return null;

  const [at, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const createdAt = new Date(at ?? "");

  return id && UUID.test(id) && !Number.isNaN(createdAt.getTime())
    ? { createdAt, id }
    : null;
};

/**
 * One page of the alert log, newest first (keyset on created_at, id), only
 * the kinds the reader may see. Another company's alerts never match.
 */
export const listLftAlerts = async (
  companyId: string,
  options: { kinds: readonly LftAlertKind[]; cursor?: string | null },
): Promise<{ items: LftAlertLogItem[]; nextCursor: string | null }> => {
  if (options.kinds.length === 0) return { items: [], nextCursor: null };

  const after = decodeCursor(options.cursor);
  const rows = await tdb(companyId)
    .select({
      id: lftAlerts.id,
      kind: lftAlerts.kind,
      personId: lftAlerts.personId,
      dueOn: lftAlerts.dueOn,
      details: lftAlerts.details,
      hrRecipients: lftAlerts.hrRecipients,
      managerNotified: lftAlerts.managerNotified,
      createdAt: lftAlerts.createdAt,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(lftAlerts)
    .innerJoin(
      people,
      and(
        eq(people.companyId, lftAlerts.companyId),
        eq(people.id, lftAlerts.personId),
      ),
    )
    .where(
      withTenant(
        lftAlerts,
        companyId,
        inArray(lftAlerts.kind, [...options.kinds]),
        after
          ? or(
              lt(lftAlerts.createdAt, after.createdAt),
              and(
                eq(lftAlerts.createdAt, after.createdAt),
                lt(lftAlerts.id, after.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(lftAlerts.createdAt), desc(lftAlerts.id))
    .limit(LFT_ALERTS_PAGE_SIZE + 1);

  const items = rows.slice(0, LFT_ALERTS_PAGE_SIZE).map((row) => ({
    id: row.id,
    kind: row.kind,
    personId: row.personId,
    personName: formatPersonName(row),
    dueOn: row.dueOn,
    details: row.details,
    hrRecipients: row.hrRecipients,
    managerNotified: row.managerNotified,
    createdAt: row.createdAt,
  }));

  return {
    items,
    nextCursor:
      rows.length > LFT_ALERTS_PAGE_SIZE ? encodeCursor(items.at(-1)!) : null,
  };
};

/** The kinds a holder of `permissions` may read in the log. */
export const readableAlertKinds = (permissions: ReadonlySet<string>) =>
  (Object.keys(LFT_ALERT_PERMISSIONS) as LftAlertKind[]).filter((kind) =>
    permissions.has(LFT_ALERT_PERMISSIONS[kind].read),
  );
