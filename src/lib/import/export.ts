import { PassThrough } from "node:stream";

import ExcelJS from "exceljs";
import {
  and,
  asc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import {
  areas,
  contracts,
  people,
  personSchedules,
  positions,
  sites,
} from "@/lib/db/schema";

import {
  CSV_BOM,
  contractExportRow,
  csvLine,
  exportHeaders,
  orderedValues,
  personExportRow,
  scheduleExportRow,
  type ExportContract,
  type ExportPerson,
  type ExportSchedule,
} from "./export-rows";
import { IMPORT_COLUMNS, SHEET_NAMES, type ImportSheetKey } from "./format";

export const EXPORT_PAGE_SIZE = 500;

export type ExportFilters = {
  status?: "activa" | "baja";
  deleted?: boolean;
  areaId?: string;
  siteId?: string;
  query?: string;
};

export type ExportOptions = {
  format: "xlsx" | "csv";
  filters: ExportFilters;
  /** Contracts need contracts:read; the caller decides. */
  includeContracts: boolean;
};

const manager = alias(people, "manager");

const buildWhere = (filters: ExportFilters, afterId?: string) =>
  and(
    filters.deleted ? isNotNull(people.deletedAt) : isNull(people.deletedAt),
    filters.status ? eq(people.status, filters.status) : undefined,
    filters.areaId ? eq(people.areaId, filters.areaId) : undefined,
    filters.siteId ? eq(people.siteId, filters.siteId) : undefined,
    filters.query?.trim()
      ? or(
          ilike(people.nombres, `%${filters.query.trim()}%`),
          ilike(people.apellidoPaterno, `%${filters.query.trim()}%`),
          ilike(people.curp, `%${filters.query.trim()}%`),
          ilike(people.rfc, `%${filters.query.trim()}%`),
        )
      : undefined,
    afterId ? gt(people.id, afterId) : undefined,
  );

/** Keyset page ordered by id: stable under concurrent edits, no OFFSET scans. */
const fetchPeoplePage = async (
  filters: ExportFilters,
  afterId?: string,
): Promise<ExportPerson[]> =>
  db
    .select({
      id: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
      email: people.email,
      telefono: people.telefono,
      fechaNacimiento: people.fechaNacimiento,
      fechaIngreso: people.fechaIngreso,
      areaName: areas.name,
      positionName: positions.name,
      siteName: sites.name,
      managerId: people.managerId,
      managerCurp: manager.curp,
      rfc: people.rfc,
      curp: people.curp,
      nss: people.nss,
      status: people.status,
    })
    .from(people)
    .leftJoin(areas, eq(people.areaId, areas.id))
    .leftJoin(positions, eq(people.positionId, positions.id))
    .leftJoin(sites, eq(people.siteId, sites.id))
    .leftJoin(manager, eq(people.managerId, manager.id))
    .where(buildWhere(filters, afterId))
    .orderBy(asc(people.id))
    .limit(EXPORT_PAGE_SIZE);

const fetchSchedules = async (
  personIds: string[],
): Promise<ExportSchedule[]> =>
  personIds.length === 0
    ? []
    : db
        .select({
          personId: personSchedules.personId,
          entrada: personSchedules.entrada,
          salidaComer: personSchedules.salidaComer,
          regresoComer: personSchedules.regresoComer,
          salida: personSchedules.salida,
        })
        .from(personSchedules)
        .where(
          and(
            inArray(personSchedules.personId, personIds),
            isNull(personSchedules.deletedAt),
          ),
        );

const fetchContracts = async (
  personIds: string[],
): Promise<ExportContract[]> =>
  personIds.length === 0
    ? []
    : db
        .select({
          personId: contracts.personId,
          type: contracts.type,
          startDate: contracts.startDate,
          endDate: contracts.endDate,
          noticeWindow: contracts.noticeWindow,
          status: contracts.status,
          templateName: contracts.templateName,
        })
        .from(contracts)
        .where(
          and(
            inArray(contracts.personId, personIds),
            isNull(contracts.deletedAt),
          ),
        )
        .orderBy(asc(contracts.personId), asc(contracts.startDate));

type Sink = {
  /** Called once per row of a sheet. */
  row: (sheet: ImportSheetKey, values: string[]) => void;
  finish: () => Promise<void>;
};

const xlsxSink = (stream: PassThrough, includeContracts: boolean): Sink => {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream,
    useStyles: true,
  });
  const keys: ImportSheetKey[] = includeContracts
    ? ["personas", "horarios", "contratos"]
    : ["personas", "horarios"];
  const sheets = new Map(
    keys.map((key) => {
      const sheet = workbook.addWorksheet(SHEET_NAMES[key], {
        views: [{ state: "frozen", ySplit: 1 }],
      });

      sheet.columns = IMPORT_COLUMNS[key].map((column) => ({
        header: column.label,
        key: column.key,
        width: column.width,
      }));
      sheet.getRow(1).font = { bold: true };

      return [key, sheet] as const;
    }),
  );

  return {
    row: (sheet, values) => {
      sheets.get(sheet)?.addRow(values).commit();
    },
    finish: async () => {
      for (const sheet of sheets.values()) sheet.commit();
      await workbook.commit();
    },
  };
};

const csvSink = (stream: PassThrough): Sink => {
  stream.write(CSV_BOM + csvLine(exportHeaders("personas")));

  return {
    row: (sheet, values) => {
      if (sheet === "personas") stream.write(csvLine(values));
    },
    finish: async () => {
      stream.end();
    },
  };
};

/**
 * Streams the export page by page into `stream`; resolves with the number of
 * people written. Memory stays at one page whatever the table size.
 */
export const writeExport = async (
  stream: PassThrough,
  options: ExportOptions,
) => {
  const sink =
    options.format === "csv"
      ? csvSink(stream)
      : xlsxSink(stream, options.includeContracts);
  const needsExtras = options.format === "xlsx";
  let afterId: string | undefined;
  let written = 0;

  for (;;) {
    const page = await fetchPeoplePage(options.filters, afterId);

    if (page.length === 0) break;

    const ids = page.map((person) => person.id);
    const [schedules, contractRows] = needsExtras
      ? await Promise.all([
          fetchSchedules(ids),
          options.includeContracts ? fetchContracts(ids) : Promise.resolve([]),
        ])
      : [[], []];
    const scheduleByPerson = new Map(schedules.map((s) => [s.personId, s]));
    const contractsByPerson = new Map<string, ExportContract[]>();

    for (const contract of contractRows) {
      contractsByPerson.set(contract.personId, [
        ...(contractsByPerson.get(contract.personId) ?? []),
        contract,
      ]);
    }

    for (const person of page) {
      sink.row("personas", orderedValues("personas", personExportRow(person)));

      const schedule = scheduleByPerson.get(person.id);

      if (schedule) {
        sink.row(
          "horarios",
          orderedValues("horarios", scheduleExportRow(schedule, person)),
        );
      }

      for (const contract of contractsByPerson.get(person.id) ?? []) {
        sink.row(
          "contratos",
          orderedValues("contratos", contractExportRow(contract, person)),
        );
      }
    }

    written += page.length;
    afterId = page[page.length - 1].id;

    if (page.length < EXPORT_PAGE_SIZE) break;
  }

  await sink.finish();

  return written;
};
