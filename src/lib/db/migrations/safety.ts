/**
 * Flags SQL migrations that can lose or rewrite existing data (pattern from ZigZag).
 *
 * A migration with a risky statement must carry an explicit approval line:
 *   -- data-loss-ok: <why this is safe, e.g. column unused since WRK-12 and backed up>
 * `npm run check:migrations` only looks at migrations a pull request adds or
 * changes, so migrations that already shipped are not re-judged.
 */

export type MigrationRisk = { rule: string; line: number; text: string };

export const RULES: { id: string; pattern: RegExp }[] = [
  { id: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { id: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { id: "DROP SCHEMA", pattern: /\bDROP\s+SCHEMA\b/i },
  { id: "DROP DATABASE", pattern: /\bDROP\s+DATABASE\b/i },
  { id: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
  { id: "DELETE FROM", pattern: /\bDELETE\s+FROM\b/i },
  {
    id: "UPDATE ... SET",
    pattern: /\bUPDATE\s+(?:ONLY\s+)?[\w."]+\s+(?:AS\s+\w+\s+)?SET\b/i,
  },
  {
    id: "ALTER COLUMN ... TYPE",
    pattern: /\bALTER\s+COLUMN\s+[\w"]+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
  },
];

const APPROVAL = /^[ \t]*--[ \t]*data-loss-ok:[ \t]*\S/m;

/** Blanks out comments and string literals, keeping newlines so line numbers stay true. */
export const stripSql = (sql: string) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .replace(/--[^\n]*/g, (match) => " ".repeat(match.length))
    .replace(/'(?:[^']|'')*'/g, (match) => match.replace(/[^\n]/g, " "));

export const findRisks = (sql: string): MigrationRisk[] => {
  const stripped = stripSql(sql);
  const original = sql.split("\n");
  const risks: MigrationRisk[] = [];

  for (const { id, pattern } of RULES) {
    const match = pattern.exec(stripped);

    if (!match) {
      continue;
    }

    const line = stripped.slice(0, match.index).split("\n").length;
    risks.push({ rule: id, line, text: (original[line - 1] ?? "").trim() });
  }

  return risks.sort((a, b) => a.line - b.line);
};

export const hasApproval = (sql: string) => APPROVAL.test(sql);

export const evaluateMigrations = (files: { path: string; sql: string }[]) => {
  const violations: { path: string; risks: MigrationRisk[] }[] = [];
  const approved: string[] = [];

  for (const { path, sql } of files) {
    const risks = findRisks(sql);

    if (risks.length === 0) {
      continue;
    }

    if (hasApproval(sql)) {
      approved.push(path);
    } else {
      violations.push({ path, risks });
    }
  }

  return { violations, approved };
};

export const formatViolations = (
  violations: { path: string; risks: MigrationRisk[] }[],
) =>
  [
    "Migration safety check failed: these migrations can lose or rewrite existing data.",
    "",
    ...violations.flatMap(({ path, risks }) => [
      `  ${path}`,
      ...risks.map(
        (risk) => `    line ${risk.line}: ${risk.rule}  ${risk.text}`,
      ),
    ]),
    "",
    "If the statement is intended and safe (data backed up, column unused), add a line to the",
    "migration explaining why, then push again:",
    "  -- data-loss-ok: <reason>",
    "Prefer additive changes: add the new column now, drop the old one in a later release.",
  ].join("\n");
