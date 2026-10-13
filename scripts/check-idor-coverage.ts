/**
 * Fails when a protected surface lacks cross-company (IDOR) coverage.
 *
 * Surfaces are discovered from the code, not listed by hand:
 *   - every server action (exports of "use server" files under src/lib),
 *   - every route handler method under src/app (except /api/auth),
 *   - every lib function whose first parameter is `companyId: string`.
 * Each must have a row in docs/idor-matrix.md. A ✅ row needs a test in
 * src/test/idor/*.db.test.ts titled with the surface id; a row whose
 * permission is a write (not :read) also needs a "rbac:<surface>" test. A ⏭️
 * row needs a reason. Rows for surfaces that no longer exist fail too.
 *
 *   npm run check:idor
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const rel = (file: string) =>
  path.relative(root, file).split(path.sep).join("/");

export const collectSurfaces = () => {
  const surfaces = new Set<string>();
  const libFiles = walk(path.join(root, "src/lib")).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  );

  for (const file of libFiles) {
    const source = readFileSync(file, "utf8");
    const module = rel(file)
      .replace(/^src\/lib\//, "")
      .replace(/\.ts$/, "");

    if (source.trimStart().startsWith('"use server"')) {
      const area = module.split("/")[0];
      for (const match of source.matchAll(/^export const (\w+)/gm)) {
        surfaces.add(`action:${area}/${match[1]}`);
      }
      continue;
    }

    const name = module.replace(/\/index$/, "");
    for (const match of source.matchAll(
      /export const (\w+) = async \(\s*companyId: string/g,
    )) {
      surfaces.add(`lib:${name}/${match[1]}`);
    }
  }

  for (const file of walk(path.join(root, "src/app")).filter((f) =>
    f.endsWith("route.ts"),
  )) {
    const route = "/" + rel(path.dirname(file)).replace(/^src\/app\/?/, "");

    if (route.startsWith("/api/auth")) continue;

    for (const match of readFileSync(file, "utf8").matchAll(
      /^export const (GET|POST|PUT|PATCH|DELETE)\b/gm,
    )) {
      surfaces.add(`route:${match[1]} ${route}`);
    }
  }

  return surfaces;
};

type Row = {
  surface: string;
  status: string;
  test: string;
  permission: string;
};

export const parseMatrix = (markdown: string): Row[] =>
  markdown
    .split("\n")
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      const [surface, status, test, permission] = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      return {
        surface: surface.replace(/`/g, ""),
        status,
        test,
        permission: (permission ?? "").replace(/`/g, ""),
      };
    });

const main = () => {
  const surfaces = collectSurfaces();
  const rows = parseMatrix(
    readFileSync(path.join(root, "docs/idor-matrix.md"), "utf8"),
  );
  const tests = walk(path.join(root, "src/test/idor"))
    .filter((file) => file.endsWith(".db.test.ts"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const titled = (id: string) => tests.includes(`"${id}"`);
  const problems: string[] = [];
  const bySurface = new Map(rows.map((row) => [row.surface, row]));

  for (const surface of [...surfaces].sort()) {
    const row = bySurface.get(surface);

    if (!row) {
      problems.push(`${surface}: no row in docs/idor-matrix.md`);
    } else if (row.status.startsWith("⏭️")) {
      if (!/\w{4,}/.test(row.test))
        problems.push(`${surface}: exempt without a reason`);
    } else if (!row.status.startsWith("✅")) {
      problems.push(`${surface}: status is "${row.status}", not covered`);
    } else if (!titled(surface)) {
      problems.push(`${surface}: no test titled "${surface}" in src/test/idor`);
    } else if (
      row.permission &&
      row.permission !== "—" &&
      !row.permission.endsWith(":read") &&
      !titled(`rbac:${surface}`)
    ) {
      problems.push(
        `${surface}: needs ${row.permission}; no test titled "rbac:${surface}"`,
      );
    }
  }

  for (const row of rows) {
    if (!surfaces.has(row.surface))
      problems.push(`${row.surface}: in the matrix but not in the code`);
  }

  if (problems.length > 0) {
    console.error(
      `IDOR coverage failed (${problems.length}):\n  ${problems.join("\n  ")}`,
    );
    process.exit(1);
  }

  console.log(`IDOR coverage: ${surfaces.size} surfaces covered or exempt.`);
};

if (process.argv[1]?.includes("check-idor-coverage")) {
  main();
}
