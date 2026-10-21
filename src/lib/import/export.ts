import { PassThrough } from "node:stream";

import ExcelJS from "exceljs";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { tdb } from "@/lib/db";
import {
  areas,
  contracts,
  people,
  personSchedules,
  positions,
  sites,
} from "@/lib/db/schema";
import {
  PEOPLE_COLUMNS,
  canSeePeopleColumn,
  type PeopleColumnId,
} from "@/lib/people/filter/columns";
import {
  buildPeopleWhere,
  peopleFilterContext,
  type PeopleFilterContext,
} from "@/lib/people/filter/query";
import {
  coercePeopleFilter,
  type PeopleFilter,
} from "@/lib/people/filter/schema";
import { listPeopleFilteredAfter, peopleColumnValue } from "@/lib/people/list";

import {
  CSV_BOM,
  contractExportRow,
  csvLine,
  exportHeaders,
  formatExportDate,
  orderedValues,
  personExportRow,
  scheduleExportRow,
  type ExportContract,
  type ExportPerson,
  type ExportSchedule,
} from "./export-rows";
import { IMPORT_COLUMNS, SHEET_NAMES, type ImportSheetKey } from "./format";

export const EXPORT_PAGE_SIZE = 500;

/**
 * The export's original filters (scripts, old callers). They become a
 * PeopleFilter, so they search and filter exactly as the list does.
 */
export type ExportFilters = {
  status?: "activa" | "baja";
  deleted?: boolean;
  areaId?: string;
  siteId?: string;
  /** Only people whose site is in this region (E1). */
  regionId?: string;
  query?: string;
};

/** ExportFilters as the Personas filter. */
export const exportFiltersToPeopleFilter = (
  filters: ExportFilters,
): PeopleFilter =>
  coercePeopleFilter({
    q: filters.query ?? "",
    deleted: Boolean(filters.deleted),
    conditions: [
      filters.status && {
        field: "relacion",
        op: "is",
        values: [filters.status],
      },
      filters.areaId && { field: "area", op: "is", values: [filters.areaId] },
      filters.siteId && {
        field: "sucursal",
        op: "is",
        values: [filters.siteId],
      },
      filters.regionId && {
        field: "region",
        op: "is",
        values: [filters.regionId],
      },
    ],
  });

export type ExportOptions = {
  /** Only this company's people are exported. */
  companyId: string;
  format: "xlsx" | "csv";
  /**
   * The Personas filter, read by the same WHERE as the list (buildPeopleWhere):
   * search, borrados, región and every other condition (E1, E4). Wins over
   * `filters`.
   */
  filter?: PeopleFilter;
  filters?: ExportFilters;
  /**
   * Today and the user's permissions (contract conditions need
   * contracts:read). Without it, no permission-bound condition applies.
   */
  context?: PeopleFilterContext;
  /** Contracts need contracts:read; the caller decides. */
  includeContracts: boolean;
  /**
   * «Exportar (N)»: one Personas sheet with these columns, in this order
   * (after Nombre). Columns the user may not see are dropped here too.
   * Without it, the import format (Personas, Horarios and Contratos).
   */
  columns?: readonly PeopleColumnId[];
};

type ResolvedExportOptions = ExportOptions & {
  filter: PeopleFilter;
  context: PeopleFilterContext;
};

const resolveOptions = (options: ExportOptions): ResolvedExportOptions => ({
  ...options,
  filter: options.filter ?? exportFiltersToPeopleFilter(options.filters ?? {}),
  context: options.context ?? peopleFilterContext(new Set()),
});

const manager = alias(people, "manager");

/** Keyset page ordered by id: stable under concurrent edits, no OFFSET scans. */
const fetchPeoplePage = async (
  companyId: string,
  options: ResolvedExportOptions,
  afterId?: string,
): Promise<ExportPerson[]> =>
  tdb(companyId)
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
    .where(
      and(
        buildPeopleWhere(companyId, options.filter, options.context),
        afterId ? gt(people.id, afterId) : undefined,
      ),
    )
    .orderBy(asc(people.id))
    .limit(EXPORT_PAGE_SIZE);

const fetchSchedules = async (
  companyId: string,
  personIds: string[],
): Promise<ExportSchedule[]> =>
  personIds.length === 0
    ? []
    : tdb(companyId)
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
            eq(personSchedules.companyId, companyId),
            inArray(personSchedules.personId, personIds),
            isNull(personSchedules.deletedAt),
          ),
        );

const fetchContracts = async (
  companyId: string,
  personIds: string[],
): Promise<ExportContract[]> =>
  personIds.length === 0
    ? []
    : tdb(companyId)
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
            eq(contracts.companyId, companyId),
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
  input: ExportOptions,
) => {
  const options = resolveOptions(input);

  if (options.columns) {
    return writeColumnsExport(stream, { ...options, columns: options.columns });
  }

  const sink =
    options.format === "csv"
      ? csvSink(stream)
      : xlsxSink(stream, options.includeContracts);
  const needsExtras = options.format === "xlsx";
  let afterId: string | undefined;
  let written = 0;

  for (;;) {
    const page = await fetchPeoplePage(options.companyId, options, afterId);

    if (page.length === 0) break;

    const ids = page.map((person) => person.id);
    const [schedules, contractRows] = needsExtras
      ? await Promise.all([
          fetchSchedules(options.companyId, ids),
          options.includeContracts
            ? fetchContracts(options.companyId, ids)
            : Promise.resolve([]),
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

/** Header and values of «Exportar (N)»: Nombre plus the visible columns. */
const DATE_COLUMNS = new Set<PeopleColumnId>(["ingreso", "finContrato"]);

/**
 * «Exportar (N)»: the people of the filter with the columns the list shows,
 * in one sheet (XLSX) or one CSV. Same WHERE and same rows as the list.
 */
const writeColumnsExport = async (
  stream: PassThrough,
  options: ResolvedExportOptions & { columns: readonly PeopleColumnId[] },
) => {
  const columns = options.columns.filter((id) =>
    canSeePeopleColumn(id, options.context.permissions),
  );
  const headers = [
    "ID Workia",
    "Nombre",
    ...columns.map((id) => PEOPLE_COLUMNS[id].label),
  ];
  let row: (values: string[]) => void;
  let finish: () => Promise<void>;

  if (options.format === "csv") {
    stream.write(CSV_BOM + csvLine(headers));
    row = (values) => stream.write(csvLine(values));
    finish = async () => {
      stream.end();
    };
  } else {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream,
      useStyles: true,
    });
    const sheet = workbook.addWorksheet(SHEET_NAMES.personas, {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    sheet.columns = headers.map((header, index) => ({
      header,
      key: `c${index}`,
      width: index === 1 ? 32 : 18,
    }));
    sheet.getRow(1).font = { bold: true };
    row = (values) => sheet.addRow(values).commit();
    finish = async () => {
      sheet.commit();
      await workbook.commit();
    };
  }

  let afterId: string | undefined;
  let written = 0;

  for (;;) {
    const page = await listPeopleFilteredAfter(options.companyId, {
      filter: options.filter,
      context: options.context,
      columns,
      afterId,
      limit: EXPORT_PAGE_SIZE,
    });

    if (page.length === 0) break;

    for (const person of page) {
      row([
        person.id,
        [person.nombres, person.apellidoPaterno, person.apellidoMaterno]
          .filter(Boolean)
          .join(" "),
        ...columns.map((id) => {
          const value = peopleColumnValue(person, id) ?? "";
          return DATE_COLUMNS.has(id) ? formatExportDate(value) : value;
        }),
      ]);
    }

    written += page.length;
    afterId = page[page.length - 1].id;

    if (page.length < EXPORT_PAGE_SIZE) break;
  }

  await finish();

  return written;
};
