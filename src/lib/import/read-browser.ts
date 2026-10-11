import readXlsxFile from "read-excel-file/browser";

import type { RawSheet, ReadWorkbook } from "./client";

/**
 * XLSX reader for the browser. read-excel-file already unzips and parses in a
 * Web Worker, so the page stays responsive on large files.
 */
export const readWorkbookInBrowser: ReadWorkbook = async (file) => {
  const sheets = await readXlsxFile(file);

  return sheets.map(({ sheet, data }) => ({
    name: sheet,
    data: data as RawSheet["data"],
  }));
};
