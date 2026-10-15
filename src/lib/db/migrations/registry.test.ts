// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyPending,
  baseline,
  hashMigration,
  type Migration,
  migrationsThrough,
  planMigrations,
  readMigrations,
  type SqlClient,
  splitStatements,
} from "./registry";

const migration = (tag: string, sql = `SELECT '${tag}';`): Migration => ({
  tag,
  hash: hashMigration(sql),
  statements: splitStatements(sql),
});

const folderWith = (tags: string[], files: string[]) => {
  const folder = mkdtempSync(path.join(tmpdir(), "workia-migrations-"));
  mkdirSync(path.join(folder, "meta"));
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ entries: tags.map((tag) => ({ tag })) }),
  );
  for (const file of files) {
    writeFileSync(path.join(folder, `${file}.sql`), `SELECT 1;`);
  }
  return folder;
};

/** In-memory stand-in for Postgres: keeps registry rows, honours BEGIN/ROLLBACK. */
const fakeClient = (failOn?: string) => {
  let rows: { tag: string; hash: string; mode: string; applied_at: string }[] =
    [];
  let snapshot = rows;
  const executed: string[] = [];

  const client: SqlClient = {
    query: async (text, params = []) => {
      if (text === "BEGIN") {
        snapshot = [...rows];
      } else if (text === "ROLLBACK") {
        rows = snapshot;
      } else if (text.startsWith('SELECT "tag"')) {
        return { rows };
      } else if (text.startsWith("INSERT INTO")) {
        const [tag, hash] = params as string[];
        rows.push({
          tag,
          hash,
          mode: text.includes("'baseline'") ? "baseline" : "applied",
          applied_at: new Date().toISOString(),
        });
      } else if (failOn && text.includes(failOn)) {
        throw new Error("boom");
      } else if (!/^(CREATE|SELECT pg_advisory|COMMIT)/.test(text.trim())) {
        executed.push(text);
      }
      return { rows: [] };
    },
  };

  return { client, executed, rows: () => rows };
};

describe("readMigrations", () => {
  it("reads the repository migrations in journal order", () => {
    const tags = readMigrations(path.join(process.cwd(), "drizzle")).map(
      (m) => m.tag,
    );

    expect(tags[0]).toBe("0000_overjoyed_baron_strucker");
    expect(tags).toContain("0014_import_undo");
  });

  it("rejects a .sql file that is not in the journal", () => {
    const folder = folderWith(["0000_a"], ["0000_a", "0001_orphan"]);

    expect(() => readMigrations(folder)).toThrow(
      /0001_orphan\.sql is not in meta\/_journal\.json/,
    );
  });

  it("rejects a journal entry without its file", () => {
    const folder = folderWith(["0000_a", "0001_b"], ["0000_a"]);

    expect(() => readMigrations(folder)).toThrow(/0001_b\.sql is missing/);
  });
});

describe("planMigrations", () => {
  it("runs a migration merged out of timestamp order, which Drizzle's migrator would skip", () => {
    const all = [migration("0012_x"), migration("0010_y")];
    const plan = planMigrations(all, [{ tag: "0012_x", hash: all[0].hash }]);

    expect(plan.pending.map((m) => m.tag)).toEqual(["0010_y"]);
  });

  it("reports applied migrations whose file changed and registry rows without a file", () => {
    const plan = planMigrations(
      [migration("0000_a")],
      [
        { tag: "0000_a", hash: "old" },
        { tag: "0001_gone", hash: "h" },
      ],
    );

    expect(plan.changed.map((row) => row.tag)).toEqual(["0000_a"]);
    expect(plan.unknown).toEqual(["0001_gone"]);
  });
});

describe("migrationsThrough", () => {
  const all = [migration("0000_a"), migration("0013_b"), migration("0014_c")];

  it("takes journal entries up to the matching number", () => {
    expect(migrationsThrough(all, "0013").map((m) => m.tag)).toEqual([
      "0000_a",
      "0013_b",
    ]);
    expect(migrationsThrough(all, "0014_c")).toHaveLength(3);
  });

  it("refuses an unknown number", () => {
    expect(() => migrationsThrough(all, "0009")).toThrow(
      /No migration matches "0009"/,
    );
  });
});

describe("applyPending", () => {
  it("applies each pending migration once; a second run applies nothing", async () => {
    const all = [
      migration("0000_a"),
      migration("0001_b", "SELECT 1;--> statement-breakpoint\nSELECT 2;"),
    ];
    const { client, executed } = fakeClient();

    expect(await applyPending(client, all)).toEqual(["0000_a", "0001_b"]);
    expect(executed).toEqual(["SELECT '0000_a';", "SELECT 1;", "SELECT 2;"]);
    expect(await applyPending(client, all)).toEqual([]);
    expect(executed).toHaveLength(3);
  });

  it("rolls back a failing migration and leaves it pending", async () => {
    const all = [migration("0000_a"), migration("0001_b", "SELECT 'explode';")];
    const { client, rows } = fakeClient("explode");

    await expect(applyPending(client, all)).rejects.toThrow(
      /0001_b failed and was rolled back/,
    );
    expect(rows().map((row) => row.tag)).toEqual(["0000_a"]);
  });

  it("refuses to run when an applied migration was edited", async () => {
    const { client } = fakeClient();
    await applyPending(client, [migration("0000_a")]);

    await expect(
      applyPending(client, [migration("0000_a", "SELECT 'edited';")]),
    ).rejects.toThrow(/edited afterwards/);
  });
});

describe("baseline", () => {
  it("records migrations without running them, then only newer ones apply", async () => {
    const all = [migration("0000_a"), migration("0001_b"), migration("0002_c")];
    const { client, executed, rows } = fakeClient();

    expect(await baseline(client, migrationsThrough(all, "0001"))).toEqual([
      "0000_a",
      "0001_b",
    ]);
    expect(executed).toEqual([]);
    expect(rows().map((row) => row.mode)).toEqual(["baseline", "baseline"]);
    expect(await applyPending(client, all)).toEqual(["0002_c"]);
  });
});
