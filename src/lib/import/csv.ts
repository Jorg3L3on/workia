/** Minimal RFC 4180 reader: quotes, escaped quotes, CRLF, UTF-8 BOM. */
export const detectDelimiter = (text: string) => {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commas = firstLine.split(",").length;
  const semicolons = firstLine.split(";").length;
  const tabs = firstLine.split("\t").length;

  if (tabs > commas && tabs > semicolons) return "\t";

  return semicolons > commas ? ";" : ",";
};

export const parseCsv = (input: string): string[][] => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      endField();
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      endRow();
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    endRow();
  }

  return rows;
};
