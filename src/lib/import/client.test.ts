// @vitest-environment node
import ExcelJS from "exceljs";
import readXlsxFile from "read-excel-file/node";
import { describe, expect, it, vi } from "vitest";

import {
  ImportFileError,
  chunkRows,
  parseImportFile,
  type ReadWorkbook,
} from "./client";
import { parseCsv } from "./csv";
import { buildImportTemplate } from "./template";
import { uploadParsedFile } from "./upload";

const readWorkbook: ReadWorkbook = async (file) => {
  const buffer = Buffer.from(await file.arrayBuffer());
  const sheets = await readXlsxFile(buffer);

  return sheets.map(({ sheet, data }) => ({
    name: sheet,
    data: data as never,
  }));
};

const makeFile = (content: BlobPart, name: string) => new File([content], name);

const workbookFile = async (
  personas: (string | number | Date | null)[][],
  extra: Record<string, (string | number | null)[][]> = {},
) => {
  const workbook = new ExcelJS.Workbook();

  workbook.addWorksheet("Personas").addRows(personas);

  for (const [name, rows] of Object.entries(extra)) {
    workbook.addWorksheet(name).addRows(rows);
  }

  return makeFile(await workbook.xlsx.writeBuffer(), "personas.xlsx");
};

describe("parseCsv", () => {
  it("handles BOM, quotes, escaped quotes, CRLF and semicolons", () => {
    expect(parseCsv('﻿a;b\r\n"x;y";"he said ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x;y", 'he said "hi"'],
    ]);
  });
});

describe("parseImportFile", () => {
  it("reads xlsx, maps headers, converts dates and trims", async () => {
    const file = await workbookFile([
      ["Nombres", "Apellido Paterno", "Fecha de ingreso", "CURP"],
      ["  Ana ", "López", new Date(Date.UTC(2024, 2, 5)), null],
      [null, null, null, null],
      ["Luis", "Pérez", "05/04/2024", "abc"],
    ]);
    const parsed = await parseImportFile(file, readWorkbook);
    const personas = parsed.sheets[0];

    expect(parsed.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(personas.mapping.missingRequired).toEqual([]);
    expect(personas.rows).toEqual([
      {
        rowNumber: 2,
        cells: {
          nombres: "Ana",
          apellidoPaterno: "López",
          fechaIngreso: "2024-03-05",
          curp: null,
        },
      },
      {
        rowNumber: 4,
        cells: {
          nombres: "Luis",
          apellidoPaterno: "Pérez",
          fechaIngreso: "2024-04-05",
          curp: "abc",
        },
      },
    ]);
  });

  it("reads the Horarios and Contratos sheets next to Personas", async () => {
    const file = await workbookFile(
      [
        ["Nombres", "Apellido paterno"],
        ["Ana", "López"],
      ],
      {
        Horarios: [
          ["CURP", "Entrada"],
          ["X", 0.375],
        ],
      },
    );
    const parsed = await parseImportFile(file, readWorkbook);

    expect(parsed.sheets.map((s) => s.sheet)).toEqual(["personas", "horarios"]);
    expect(parsed.sheets[1].rows[0].cells.entrada).toBe("09:00");
    expect(parsed.totalRows).toBe(2);
  });

  it("reads a CSV as Personas", async () => {
    const csv = "﻿Nombres,Apellido paterno\nAna,López\n";
    const parsed = await parseImportFile(
      makeFile(csv, "personas.csv"),
      readWorkbook,
    );

    expect(parsed.sheets[0].rows[0].cells.nombres).toBe("Ana");
  });

  it("rejects bad files with a specific code", async () => {
    const code = async (file: File) =>
      parseImportFile(file, readWorkbook).catch(
        (error: ImportFileError) => error.code,
      );

    expect(await code(makeFile("x", "notes.txt"))).toBe("unsupported");
    expect(await code(makeFile("", "empty.csv"))).toBe("empty");
    expect(
      await code(
        await workbookFile([
          ["Nombres", "Nombres"],
          ["a", "b"],
        ]),
      ),
    ).toBe("duplicate_headers");
    expect(
      await code(makeFile(new Uint8Array(10 * 1024 * 1024 + 1), "big.xlsx")),
    ).toBe("too_large");
  });

  it("rejects files over the row limit", async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => `P${i},X`);
    const file = makeFile(
      `Nombres,Apellido paterno\n${rows.join("\n")}`,
      "a.csv",
    );

    await expect(parseImportFile(file, readWorkbook)).rejects.toMatchObject({
      code: "too_many_rows",
    });
  });

  it("parses the downloadable template as an empty personas sheet", async () => {
    const buffer = await buildImportTemplate({
      areas: [],
      positions: [],
      sites: [],
      templates: [],
    });
    const file = makeFile(buffer, "plantilla.xlsx");

    // Headers validate; an empty template has no rows to import.
    await expect(parseImportFile(file, readWorkbook)).rejects.toMatchObject({
      code: "empty",
    });
  });
});

describe("upload", () => {
  it("chunks 5,000 rows, retries a failed chunk and finalizes", async () => {
    const csv = `Nombres,Apellido paterno\n${Array.from({ length: 5000 }, (_, i) => `P${i},X`).join("\n")}`;
    const parsed = await parseImportFile(makeFile(csv, "a.csv"), readWorkbook);
    const stored = new Map<number, number>();
    let failedOnce = false;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));

      if (url.endsWith("/api/import/personas")) {
        return Response.json({ jobId: "job-1", previous: [] });
      }

      if (url.endsWith("/rows")) {
        if (!failedOnce && body.rows[0].rowNumber === 502) {
          failedOnce = true;
          return new Response("{}", { status: 503 });
        }

        for (const row of body.rows) stored.set(row.rowNumber, 1);

        return Response.json({ stored: body.rows.length });
      }

      return Response.json({ total: stored.size });
    }) as unknown as typeof fetch;
    const progress = vi.fn();

    const result = await uploadParsedFile(parsed, {
      fetchImpl,
      onProgress: progress,
      retries: 2,
    });

    expect(result).toMatchObject({ jobId: "job-1", total: 5000 });
    expect(stored.size).toBe(5000);
    expect(failedOnce).toBe(true);
    expect(progress).toHaveBeenLastCalledWith({
      sentRows: 5000,
      totalRows: 5000,
    });
    expect(chunkRows(parsed.sheets[0].rows)).toHaveLength(10);
  });
});
