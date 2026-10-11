/**
 * Scale check for personas import/export: a 5,000-person file with contract
 * history and seeded errors goes through parse → stage → validate → apply
 * (with a kill and resume) → export → re-import → undo, and every step is
 * compared with the budgets in docs/personas-import-budgets.md.
 *
 *   npm run import:budgets            # local Postgres only
 *
 * It writes rows (and undoes them), so it refuses to run against a remote
 * database.
 */

import { spawn } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import pg from "pg";
import readXlsxFile from "read-excel-file/node";

config({ path: ".env.local" });
config();

const host = new URL(process.env.DATABASE_URL ?? "postgresql://x@remote/x")
  .hostname;

if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
  console.error(
    "Refusing to run: DATABASE_URL must point to a local Postgres.",
  );
  process.exit(2);
}

let statements = 0;
const originalQuery = pg.Client.prototype.query as (
  ...args: unknown[]
) => unknown;

(pg.Client.prototype as unknown as { query: unknown }).query = function (
  ...args: unknown[]
) {
  statements += 1;

  return originalQuery.apply(this, args);
};

/** Seconds and statement counts allowed per step (local Postgres). */
const BUDGETS = {
  parse: { seconds: 15 },
  stage: { seconds: 10, statements: 60 },
  validate: { seconds: 30, statements: 400 },
  apply: { seconds: 60, statements: 2500 },
  export: { seconds: 15, rssMb: 200 },
  reimport: { seconds: 40, statements: 500 },
  undo: { seconds: 40, statements: 2500 },
} as const;

const PEOPLE = Number(process.env.IMPORT_BUDGET_PEOPLE ?? 5000);
const RUN = Math.floor(Date.now() / 1000) % 40;

type Row = {
  step: string;
  seconds: number;
  statements: number | null;
  extra: string;
  ok: boolean;
};
const report: Row[] = [];

const record = (
  step: keyof typeof BUDGETS,
  seconds: number,
  used: number | null,
  extra = "",
  rssMb?: number,
) => {
  const budget = BUDGETS[step] as {
    seconds: number;
    statements?: number;
    rssMb?: number;
  };
  const ok =
    seconds <= budget.seconds &&
    (budget.statements === undefined ||
      used === null ||
      used <= budget.statements) &&
    (budget.rssMb === undefined ||
      rssMb === undefined ||
      rssMb <= budget.rssMb);

  report.push({
    step,
    seconds: Math.round(seconds * 100) / 100,
    statements: used,
    extra: rssMb === undefined ? extra : `${extra} rss+${rssMb}MB`.trim(),
    ok,
  });
};

const timed = async <T>(fn: () => Promise<T>) => {
  const before = statements;
  const start = performance.now();
  const value = await fn();

  return {
    value,
    seconds: (performance.now() - start) / 1000,
    used: statements - before,
  };
};

const applyChild = async (jobId: string) => {
  const { applyJobStep } = await import("@/lib/import/apply");

  for (;;) {
    const step = await applyJobStep(jobId);

    if (step.done) break;
  }

  process.exit(0);
};

const main = async () => {
  if (process.argv[2] === "--apply-child") {
    return applyChild(process.argv[3]);
  }

  const { db } = await import("@/lib/db");
  const { importJobs, importRows, users, people } =
    await import("@/lib/db/schema");
  const jobs = await import("@/lib/import/jobs");
  const validate = await import("@/lib/import/validate");
  const apply = await import("@/lib/import/apply");
  const undo = await import("@/lib/import/undo");
  const { writeExport } = await import("@/lib/import/export");
  const { parseImportFile } = await import("@/lib/import/client");
  const { generateImportFixture } =
    await import("@/lib/import/testing/fixture");

  const [actor] = await db.select().from(users).limit(1);
  const lastName = `Budget${RUN}`;
  const readWorkbook = async (blob: Blob) =>
    (await readXlsxFile(Buffer.from(await blob.arrayBuffer()))).map(
      (sheet) => ({
        name: sheet.sheet,
        data: sheet.data as never,
      }),
    );

  const stageFile = async (
    file: File,
    options: {
      createMissingCatalogs: boolean;
      mode: "valid_only" | "all_or_nothing";
    },
  ) => {
    const parsed = await parseImportFile(file, readWorkbook);
    const job = await jobs.createImportJob(
      {
        fileName: file.name,
        fileHash: parsed.fileHash,
        fileSizeBytes: file.size,
        totalRows: parsed.totalRows,
      },
      actor.id,
    );

    for (const sheet of parsed.sheets) {
      for (let i = 0; i < sheet.rows.length; i += 500) {
        await jobs.appendImportRows(job.id, {
          sheet: sheet.sheet,
          rows: sheet.rows.slice(i, i + 500),
        });
      }
    }

    await jobs.finalizeImportUpload(job.id, parsed.totalRows);
    await db
      .update(importJobs)
      .set({ options })
      .where(eq(importJobs.id, job.id));

    return { job, parsed };
  };

  const validateJob = async (jobId: string) => {
    let step;

    do {
      step = await validate.validateJobStep(jobId);
    } while (!step.done);

    return step.counts;
  };

  const snapshot = async () =>
    (
      await db.execute(sql`select
        (select md5(coalesce(string_agg(p::text, '|' order by id), '')) from (select id, nombres, curp, rfc, email, manager_id, area_id, status from people where deleted_at is null) p) people,
        (select md5(coalesce(string_agg(c::text, '|' order by id), '')) from (select id, person_id, start_date, end_date, status, previous_contract_id from contracts where deleted_at is null) c) contracts,
        (select md5(coalesce(string_agg(s::text, '|' order by person_id), '')) from (select person_id, entrada, salida from person_schedules where deleted_at is null) s) schedules`)
    ).rows[0];

  console.log(`Generating fixture: ${PEOPLE} people (run ${RUN})…`);
  const { buffer, summary } = await generateImportFixture({
    people: PEOPLE,
    run: RUN,
    withErrors: true,
    lastName,
  });
  const file = new File([new Uint8Array(buffer)], `fixture-${PEOPLE}.xlsx`);

  const before = await snapshot();

  // 1) Parse in memory (browser parsing time is of the same order).
  const parse = await timed(() => parseImportFile(file, readWorkbook));

  record(
    "parse",
    parse.seconds,
    null,
    `${parse.value.totalRows} rows, ${(buffer.length / 1e6).toFixed(1)} MB`,
  );

  // 2) Stage
  const stage = await timed(() =>
    stageFile(file, { createMissingCatalogs: true, mode: "valid_only" }),
  );
  const { job } = stage.value;

  record("stage", stage.seconds, stage.used);

  // 3) Validate
  const validated = await timed(() => validateJob(job.id));

  record(
    "validate",
    validated.seconds,
    validated.used,
    JSON.stringify(validated.value),
  );

  // 4) Apply with a kill in the middle, then resume
  const apply1 = await timed(async () => {
    const child = spawn(
      "npx",
      ["tsx", "scripts/measure-import-budgets.ts", "--apply-child", job.id],
      {
        stdio: "ignore",
        detached: true,
      },
    );
    const exited = new Promise<number>((resolve) =>
      child.on("exit", (code) => resolve(code ?? -1)),
    );
    const killer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* already finished */
      }
    }, 2500);

    await exited;
    clearTimeout(killer);

    const [mid] = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, job.id));
    const killedMidway = mid.status !== "applied";

    if (killedMidway) {
      // The lock is released by pausing; a real user clicks "Continuar importación".
      await db
        .update(importJobs)
        .set({ status: "failed" })
        .where(
          and(eq(importJobs.id, job.id), eq(importJobs.status, "applying")),
        );
    }

    let step;

    do {
      step = await apply.applyJobStep(job.id);
    } while (!step.done);

    return { killedMidway, applied: step.applied };
  });

  record(
    "apply",
    apply1.seconds,
    apply1.used,
    `applied ${apply1.value.applied}, killed midway: ${apply1.value.killedMidway}`,
  );

  const [{ n }] = (
    await db.execute(
      sql`select count(*)::int n from people where apellido_paterno = ${lastName} and deleted_at is null`,
    )
  ).rows as { n: number }[];
  const [{ d }] = (
    await db.execute(
      sql`select count(distinct curp)::int d from people where apellido_paterno = ${lastName} and deleted_at is null`,
    )
  ).rows as { d: number }[];
  const unapplied = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(importRows)
    .where(
      sql`${importRows.jobId} = ${job.id} and action in ('create','update') and applied_at is null`,
    );
  const expectedPeople = summary.people - summary.brokenPeople;
  const duplicates = n - d;

  console.log(
    `people created: ${n} (expected ${expectedPeople}), duplicates: ${duplicates}, unapplied rows: ${unapplied[0].c}`,
  );

  // 5) Export the imported people (filtered by their shared last name)
  const exportPath = join(tmpdir(), `import-budget-${RUN}.xlsx`);
  globalThis.gc?.();

  const rssBefore = process.memoryUsage().rss;
  let peakRss = rssBefore;
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 25);
  const exported = await timed(async () => {
    const stream = new PassThrough();
    const out = createWriteStream(exportPath);

    stream.pipe(out);

    const count = await writeExport(stream, {
      format: "xlsx",
      filters: { query: lastName },
      includeContracts: true,
    });

    await new Promise<void>((resolve) => out.on("close", () => resolve()));

    return count;
  });

  clearInterval(sampler);
  record(
    "export",
    exported.seconds,
    exported.used,
    `${exported.value} people`,
    Math.round((peakRss - rssBefore) / 1e6),
  );

  // 6) Re-import the export: everything valid must be unchanged
  const exportedFile = new File([readFileSync(exportPath)], "export.xlsx");
  const reimport = await timed(async () => {
    const staged = await stageFile(exportedFile, {
      createMissingCatalogs: false,
      mode: "valid_only",
    });

    return { jobId: staged.job.id, counts: await validateJob(staged.job.id) };
  });
  const counts = reimport.value.counts ?? {};

  record("reimport", reimport.seconds, reimport.used, JSON.stringify(counts));

  const changed = (counts.create ?? 0) + (counts.update ?? 0);

  // 7) Undo the import and compare the database with its state before
  const undone = await timed(async () => {
    let step;

    do {
      step = await undo.undoJobStep(job.id);
    } while (!step.done);
  });
  const after = await snapshot();
  const identical = JSON.stringify(before) === JSON.stringify(after);

  record(
    "undo",
    undone.seconds,
    undone.used,
    `database identical to before: ${identical}`,
  );

  await db.delete(importJobs).where(eq(importJobs.id, reimport.value.jobId));
  await db.delete(importJobs).where(eq(importJobs.id, job.id));
  void people;

  console.table(report);

  const failures = report.filter((row) => !row.ok).map((row) => row.step);
  const problems = [
    ...(failures.length ? [`over budget: ${failures.join(", ")}`] : []),
    ...(duplicates !== 0 ? ["duplicate CURPs after apply"] : []),
    ...(unapplied[0].c !== 0 ? ["rows left unapplied after resume"] : []),
    ...(n !== expectedPeople
      ? [`created ${n}, expected ${expectedPeople}`]
      : []),
    ...(changed !== 0
      ? [`re-import of the export is not unchanged (${changed} create/update)`]
      : []),
    ...(!identical ? ["undo did not restore the database"] : []),
  ];

  if (problems.length > 0) {
    console.error(`FAILED: ${problems.join("; ")}`);
    process.exit(1);
  }

  console.log("All budgets met.");
  process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
