import { createHash } from "node:crypto";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction } from "@/lib/db";
import {
  attendanceBadges,
  incidenciasPeriodSnapshot,
  people,
  prenominaTemplates,
  sites,
} from "@/lib/db/schema";
import { getPayPeriod, type PayPeriodView } from "@/lib/pay-periods";
import { quincenaRange } from "@/lib/pay-periods/quincena";
import { withTenant } from "@/lib/tenant/scope";

import { prenominaContentType, renderPrenominaFile } from "./file";
import {
  buildPrenominaSheet,
  type PrenominaPerson,
  type PrenominaSheet,
  type SnapshotRowInput,
  sumTotals,
  totalsFromSnapshot,
} from "./rows";
import {
  DEFAULT_TEMPLATE,
  DEFAULT_TEMPLATE_ID,
  type PrenominaTemplateConfig,
  type PrenominaTemplateInput,
  prenominaTemplateSchema,
  type PrenominaTotals,
} from "./template";

/**
 * Pre-nómina (Workia 2.0 W2-18, docs/prenomina.md): the summary of a closed
 * quincena and the file for the payroll provider, built from the close
 * snapshot only (never live events), with the company's templates. Closing
 * the quincena is the approval and the lock (W2-15); changing it needs a
 * reopen with a reason. Every file handed out leaves an audit event with its
 * revision and hash. No salary is computed here.
 */

export class PrenominaError extends Error {
  constructor(
    readonly code:
      "invalid_template" | "duplicate_name" | "not_found" | "period_open",
    message: string,
  ) {
    super(message);
    this.name = "PrenominaError";
  }
}

export type PrenominaTemplateView = PrenominaTemplateConfig & {
  /** A uuid, or "workia" for the built-in template. */
  id: string;
  builtIn: boolean;
  updatedAt: Date | null;
};

const templateColumns = {
  id: prenominaTemplates.id,
  name: prenominaTemplates.name,
  format: prenominaTemplates.format,
  layout: prenominaTemplates.layout,
  delimiter: prenominaTemplates.delimiter,
  encoding: prenominaTemplates.encoding,
  dateFormat: prenominaTemplates.dateFormat,
  includeHeader: prenominaTemplates.includeHeader,
  skipEmpty: prenominaTemplates.skipEmpty,
  columns: prenominaTemplates.columns,
  conceptCodes: prenominaTemplates.conceptCodes,
  updatedAt: prenominaTemplates.updatedAt,
};

type TemplateRow = {
  [K in keyof typeof templateColumns]: (typeof templateColumns)[K]["_"]["data"];
};

const builtIn: PrenominaTemplateView = {
  ...DEFAULT_TEMPLATE,
  id: DEFAULT_TEMPLATE_ID,
  builtIn: true,
  updatedAt: null,
};

/** A stored row read back through the schema, so the file never sees bad config. */
const toView = (row: TemplateRow): PrenominaTemplateView | null => {
  const parsed = prenominaTemplateSchema.safeParse({
    name: row.name,
    format: row.format,
    layout: row.layout,
    delimiter: row.delimiter,
    encoding: row.encoding,
    dateFormat: row.dateFormat,
    includeHeader: row.includeHeader,
    skipEmpty: row.skipEmpty,
    columns: row.columns,
    conceptCodes: row.conceptCodes,
  });

  return parsed.success
    ? { ...parsed.data, id: row.id, builtIn: false, updatedAt: row.updatedAt }
    : null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The company's templates (not archived), the built-in one first. */
export const listPrenominaTemplates = async (
  companyId: string,
): Promise<PrenominaTemplateView[]> => {
  const rows = await tdb(companyId)
    .select(templateColumns)
    .from(prenominaTemplates)
    .where(
      withTenant(
        prenominaTemplates,
        companyId,
        isNull(prenominaTemplates.archivedAt),
      ),
    )
    .orderBy(asc(sql`lower(${prenominaTemplates.name})`));

  return [
    builtIn,
    ...rows.flatMap((row) => {
      const view = toView(row);
      return view ? [view] : [];
    }),
  ];
};

/** One template by id ("workia" is the built-in one); null when not the company's. */
export const getPrenominaTemplate = async (
  companyId: string,
  id: string,
): Promise<PrenominaTemplateView | null> => {
  if (id === DEFAULT_TEMPLATE_ID) return builtIn;
  if (!UUID.test(id)) return null;

  const [row] = await tdb(companyId)
    .select(templateColumns)
    .from(prenominaTemplates)
    .where(
      withTenant(
        prenominaTemplates,
        companyId,
        and(
          eq(prenominaTemplates.id, id),
          isNull(prenominaTemplates.archivedAt),
        ),
      ),
    )
    .limit(1);

  return row ? toView(row) : null;
};

const parseTemplate = (input: PrenominaTemplateInput) => {
  const parsed = prenominaTemplateSchema.safeParse(input);

  if (!parsed.success) {
    throw new PrenominaError(
      "invalid_template",
      parsed.error.issues[0]?.message ?? "Plantilla inválida.",
    );
  }

  return parsed.data;
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  ((error as { code?: string }).code === "23505" ||
    isUniqueViolation((error as { cause?: unknown }).cause));

const duplicateName = (name: string) =>
  new PrenominaError(
    "duplicate_name",
    `Ya hay una plantilla llamada «${name}».`,
  );

const values = (config: PrenominaTemplateConfig) => ({
  name: config.name,
  format: config.format,
  layout: config.layout,
  delimiter: config.delimiter,
  encoding: config.encoding,
  dateFormat: config.dateFormat,
  includeHeader: config.includeHeader,
  skipEmpty: config.skipEmpty,
  columns: config.columns,
  conceptCodes: config.conceptCodes as Record<string, string>,
});

export const createPrenominaTemplate = async (
  companyId: string,
  input: PrenominaTemplateInput,
  options: { actorUserId?: string | null } = {},
): Promise<PrenominaTemplateView> => {
  const config = parseTemplate(input);

  if (config.name.toLowerCase() === DEFAULT_TEMPLATE.name.toLowerCase()) {
    throw duplicateName(config.name);
  }

  try {
    return await withTransaction(async (tx) => {
      const [row] = await tx
        .insert(prenominaTemplates)
        .values({
          companyId,
          ...values(config),
          createdBy: options.actorUserId ?? null,
        })
        .returning(templateColumns);

      await recordAuditEvent(
        {
          companyId,
          actorUserId: options.actorUserId ?? null,
          resourceType: "prenomina_template",
          resourceId: row.id,
          action: "create",
          payload: {
            summary: `Plantilla de pre-nómina «${config.name}»`,
            after: values(config),
          },
        },
        tx,
      );

      return toView(row)!;
    }, companyId);
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName(config.name);
    throw error;
  }
};

/** Replaces a template's configuration; null when it is not the company's. */
export const updatePrenominaTemplate = async (
  companyId: string,
  id: string,
  input: PrenominaTemplateInput,
  options: { actorUserId?: string | null } = {},
): Promise<PrenominaTemplateView | null> => {
  const config = parseTemplate(input);

  if (!UUID.test(id)) return null;

  if (config.name.toLowerCase() === DEFAULT_TEMPLATE.name.toLowerCase()) {
    throw duplicateName(config.name);
  }

  try {
    return await withTransaction(async (tx) => {
      const where = and(
        eq(prenominaTemplates.companyId, companyId),
        eq(prenominaTemplates.id, id),
        isNull(prenominaTemplates.archivedAt),
      );
      const [before] = await tx
        .select(templateColumns)
        .from(prenominaTemplates)
        .where(where)
        .for("update");

      if (!before) return null;

      const [row] = await tx
        .update(prenominaTemplates)
        .set(values(config))
        .where(where)
        .returning(templateColumns);

      await recordAuditEvent(
        {
          companyId,
          actorUserId: options.actorUserId ?? null,
          resourceType: "prenomina_template",
          resourceId: row.id,
          action: "update",
          payload: {
            summary: `Plantilla de pre-nómina «${config.name}»`,
            before: {
              name: before.name,
              format: before.format,
              layout: before.layout,
              columns: before.columns,
              conceptCodes: before.conceptCodes,
            },
            after: values(config),
          },
        },
        tx,
      );

      return toView(row);
    }, companyId);
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName(config.name);
    throw error;
  }
};

/** Archives a template (never deleted); false when it is not the company's. */
export const archivePrenominaTemplate = async (
  companyId: string,
  id: string,
  options: { actorUserId?: string | null } = {},
): Promise<boolean> => {
  if (!UUID.test(id)) return false;

  return withTransaction(async (tx) => {
    const [row] = await tx
      .update(prenominaTemplates)
      .set({ archivedAt: sql`now()` })
      .where(
        and(
          eq(prenominaTemplates.companyId, companyId),
          eq(prenominaTemplates.id, id),
          isNull(prenominaTemplates.archivedAt),
        ),
      )
      .returning({ id: prenominaTemplates.id, name: prenominaTemplates.name });

    if (!row) return false;

    await recordAuditEvent(
      {
        companyId,
        actorUserId: options.actorUserId ?? null,
        resourceType: "prenomina_template",
        resourceId: row.id,
        action: "delete",
        payload: { summary: `Plantilla de pre-nómina «${row.name}» archivada` },
      },
      tx,
    );

    return true;
  }, companyId);
};

// ------------------------------------------------------------- the period

/** The close snapshot with what justified each incidencia (0052). */
const readSnapshotRows = async (
  companyId: string,
  payPeriodId: string,
): Promise<SnapshotRowInput[]> =>
  tdb(companyId)
    .select({
      personId: incidenciasPeriodSnapshot.personId,
      kind: incidenciasPeriodSnapshot.kind,
      count: incidenciasPeriodSnapshot.count,
      justified: incidenciasPeriodSnapshot.justified,
      minutes: incidenciasPeriodSnapshot.minutes,
      justifiedMinutes: incidenciasPeriodSnapshot.justifiedMinutes,
      justifiedVacation: incidenciasPeriodSnapshot.justifiedVacation,
      justifiedPermisoConGoce:
        incidenciasPeriodSnapshot.justifiedPermisoConGoce,
      justifiedPermisoSinGoce:
        incidenciasPeriodSnapshot.justifiedPermisoSinGoce,
      justifiedIncapacidad: incidenciasPeriodSnapshot.justifiedIncapacidad,
    })
    .from(incidenciasPeriodSnapshot)
    .where(
      withTenant(
        incidenciasPeriodSnapshot,
        companyId,
        eq(incidenciasPeriodSnapshot.payPeriodId, payPeriodId),
      ),
    );

const loadPeople = async (
  companyId: string,
  ids: string[],
): Promise<PrenominaPerson[]> => {
  if (ids.length === 0) return [];

  const [rows, badges] = await Promise.all([
    tdb(companyId)
      .select({
        id: people.id,
        nombres: people.nombres,
        apellidoPaterno: people.apellidoPaterno,
        apellidoMaterno: people.apellidoMaterno,
        curp: people.curp,
        rfc: people.rfc,
        nss: people.nss,
        sucursal: sites.name,
      })
      .from(people)
      .leftJoin(
        sites,
        and(eq(sites.companyId, people.companyId), eq(sites.id, people.siteId)),
      )
      .where(withTenant(people, companyId, inArray(people.id, ids))),
    tdb(companyId)
      .select({
        personId: attendanceBadges.personId,
        badge: attendanceBadges.badge,
      })
      .from(attendanceBadges)
      .where(
        withTenant(
          attendanceBadges,
          companyId,
          inArray(attendanceBadges.personId, ids),
        ),
      )
      .orderBy(asc(attendanceBadges.badge)),
  ]);
  const badgesOf = new Map<string, string[]>();

  for (const row of badges) {
    badgesOf.set(row.personId, [
      ...(badgesOf.get(row.personId) ?? []),
      row.badge,
    ]);
  }

  return rows.map((row) => ({
    ...row,
    checador: badgesOf.get(row.id)?.join(" ") ?? null,
  }));
};

const closedPeriod = async (companyId: string, period: string) => {
  quincenaRange(period);
  const current = await getPayPeriod(companyId, period);

  return current?.status === "closed" ? current : null;
};

/** One closed quincena's snapshot by person, and the people in it. */
const loadClosed = async (companyId: string, current: PayPeriodView) => {
  const byPerson = totalsFromSnapshot(
    await readSnapshotRows(companyId, current.id),
  );
  const persons = await loadPeople(companyId, [...byPerson.keys()]);

  return { byPerson, persons };
};

export type PrenominaTemplateCheck = {
  id: string;
  name: string;
  format: PrenominaTemplateConfig["format"];
  layout: PrenominaTemplateConfig["layout"];
  builtIn: boolean;
  /** Rows and people the file would have. */
  rows: number;
  people: number;
  /** Identifier columns some person in the file lacks: the provider would reject them. */
  missing: PrenominaSheet["missing"];
};

export type PrenominaOverview = {
  period: PayPeriodView;
  /** The company's quincena added up: faltas, retardos, permisos, incapacidades, vacations. */
  totals: PrenominaTotals;
  /** People with at least one incidencia in the snapshot. */
  people: number;
  /** Every template of the company, checked against this quincena. */
  templates: PrenominaTemplateCheck[];
};

/**
 * The pre-nómina of a closed quincena for the HR screen: the company's
 * totals from the close snapshot, and for each template the file it would
 * give (rows, people, identifiers missing). Null while the quincena is open:
 * the numbers are only final once it is closed.
 */
export const getPrenominaOverview = async (
  companyId: string,
  period: string,
): Promise<PrenominaOverview | null> => {
  const current = await closedPeriod(companyId, period);

  if (!current) return null;

  const [{ byPerson, persons }, templates] = await Promise.all([
    loadClosed(companyId, current),
    listPrenominaTemplates(companyId),
  ]);

  return {
    period: current,
    totals: sumTotals(byPerson.values()),
    people: byPerson.size,
    templates: templates.map((template) => {
      const sheet = buildPrenominaSheet(
        template,
        { period: current.period, revision: current.revision },
        persons,
        byPerson,
      );

      return {
        id: template.id,
        name: template.name,
        format: template.format,
        layout: template.layout,
        builtIn: template.builtIn,
        rows: sheet.rows.length,
        people: sheet.people,
        missing: sheet.missing,
      };
    }),
  };
};

export type PrenominaFile = {
  fileName: string;
  contentType: string;
  body: Buffer;
  rows: number;
  people: number;
  sha256: string;
};

const slug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "plantilla";

/**
 * The file for the payroll provider, from a closed quincena's snapshot and a
 * template, with an audit event (prenomina_export / export) naming the
 * period, its revision, the template and the file's hash. An open quincena
 * is refused: HR closes it (approval and lock) first.
 */
export const exportPrenomina = async (
  companyId: string,
  period: string,
  templateId: string,
  options: { actorUserId?: string | null; companySlug?: string } = {},
): Promise<PrenominaFile> => {
  const template = await getPrenominaTemplate(companyId, templateId);

  if (!template) {
    throw new PrenominaError("not_found", "Esa plantilla no existe.");
  }

  const current = await closedPeriod(companyId, period);

  if (!current) {
    throw new PrenominaError(
      "period_open",
      "Cierra la quincena antes de exportar la pre-nómina.",
    );
  }

  const { byPerson, persons } = await loadClosed(companyId, current);
  const preview = {
    period: current,
    sheet: buildPrenominaSheet(
      template,
      { period: current.period, revision: current.revision },
      persons,
      byPerson,
    ),
  };

  const body = await renderPrenominaFile(preview.sheet, template);
  const sha256 = createHash("sha256").update(body).digest("hex");
  const revision = preview.period.revision;
  const fileName = [
    "prenomina",
    options.companySlug,
    period,
    `r${revision}`,
    slug(template.name),
  ]
    .filter(Boolean)
    .join("-")
    .concat(`.${template.format}`);

  await recordAuditEvent({
    companyId,
    actorUserId: options.actorUserId ?? null,
    resourceType: "prenomina_export",
    resourceId: preview.period.id,
    action: "export",
    payload: {
      summary: `Pre-nómina de ${period} (revisión ${revision}) con «${template.name}»: ${preview.sheet.people} personas, ${preview.sheet.rows.length} filas.`,
      after: {
        period,
        revision,
        templateId: template.id,
        templateName: template.name,
        format: template.format,
        rows: preview.sheet.rows.length,
        people: preview.sheet.people,
        sha256,
      },
    },
  });

  return {
    fileName,
    contentType: prenominaContentType(template),
    body,
    rows: preview.sheet.rows.length,
    people: preview.sheet.people,
    sha256,
  };
};
