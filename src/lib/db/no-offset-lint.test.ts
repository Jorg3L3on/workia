/* eslint-disable no-restricted-syntax -- the strings below are fixtures of that rule */
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/** The no-OFFSET rule of eslint.config.mjs (P-04, docs/keyset.md). */
describe("lint: no OFFSET pagination", () => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const errors = async (code: string, filePath = "src/lib/new-list.ts") => {
    const [result] = await eslint.lintText(code, { filePath });
    return result.messages
      .filter((message) => message.ruleId === "no-restricted-syntax")
      .map((message) => message.line);
  };

  it("refuses .offset() and OFFSET in SQL", async () => {
    expect(
      await errors("export const q = (db: any) => db.select().offset(20);\n"),
    ).toEqual([1]);
    expect(
      await errors(
        "declare const sql: any;\nexport const q = (n: number) => sql`SELECT 1 OFFSET ${n}`;\n",
      ),
    ).toEqual([2]);
    expect(
      await errors(
        'export const q = "select * from people limit 10 offset 20";\n',
      ),
    ).toEqual([1]);
    expect(await errors('export const q = "select 1 offset $1";\n')).toEqual([
      1,
    ]);
  });

  it("allows keyset pages and the word in prose", async () => {
    expect(
      await errors(
        'export const label = "No OFFSET scans";\nexport const q = (db: any) => db.select().limit(51);\n',
      ),
    ).toEqual([]);
  });

  it("still allows the lists that move to keyset later", async () => {
    expect(
      await errors(
        "export const q = (db: any) => db.select().offset(20);\n",
        "src/lib/audit/index.ts",
      ),
    ).toEqual([]);
  });
});
