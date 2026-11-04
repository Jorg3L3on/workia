/**
 * The manager today view (Workia 2.0 W2-17) on a real database. A manager
 * sees on shift, absent, late and pending for their live team (W2-07 scope),
 * narrowed to one site or area of it, with the latest punch of each source;
 * never another team or another company. The drill-in shows a team member's
 * attendance and incidencias and is a 404 for anyone else. Titles are the
 * surface ids of docs/idor-matrix.md.
 */
import { randomUUID } from "node:crypto";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

const employee = vi.hoisted(() => ({
  context: null as null | {
    accountId: string;
    companyId: string;
    personId: string;
    sessionId: string;
  },
}));

vi.mock("@/lib/employee-accounts/session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/employee-accounts/session")>();
  const { NavigationThrow } = await import("@/test/idor/session-state");

  return {
    ...actual,
    getEmployeeContext: async () => employee.context,
    requireEmployeeContext: async () => {
      if (!employee.context) {
        throw new NavigationThrow("redirect", actual.EMPLOYEE_SIGN_IN_PATH);
      }
      return employee.context;
    },
  };
});

import TeamMemberPage from "@/app/mi/equipo/[personId]/page";
import TeamTodayPage from "@/app/mi/equipo/hoy/page";
import { DEFAULT_CSV_FORMAT } from "@/lib/attendance/csv-format";
import {
  attendanceBatches,
  attendanceDevices,
  employeeAccounts,
  people,
  sites,
} from "@/lib/db/schema";
import { isoToday } from "@/lib/format/date";
import {
  getManagerAccess,
  listTeamPlaces,
  setManagerGrant,
  type ManagerAccess,
} from "@/lib/managers";
import { appendPersonEvents } from "@/lib/timeline";
import { incidenciaEvent } from "@/lib/timeline/events";
import { listTodayPage, todayCounts, todayImports } from "@/lib/timeline/today";
import { todayStatus } from "@/lib/timeline/today-status";
import { writeAttendanceDays } from "@/lib/timeline/writers";
import { uniqueCurp } from "@/test/curp";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { NavigationThrow } from "./session-state";

const DAY = isoToday();
const PERIOD = `${DAY.slice(0, 7)}-Q${Number(DAY.slice(8)) <= 15 ? 1 : 2}`;
const at = (time: string) => new Date(`${DAY}T${time}:00-06:00`).toISOString();
/** A punch as the writer stores it: to the second, UTC. */
const stored = (time: string) => `${at(time).slice(0, 19)}Z`;

let a: Tenant;
let b: Tenant;

type Team = {
  boss: { personId: string; accountId: string };
  onShift: string;
  left: string;
  absent: string;
  late: string;
  pending: string;
  indirect: string;
  otherTeam: string;
  northSite: string;
  checador: string;
};

let teamA: Team;
let teamB: Team;

const seedTeam = async (tenant: Tenant, label: string): Promise<Team> => {
  const { companyId } = tenant;
  const [north] = await ownerDb
    .insert(sites)
    .values({ companyId, name: `Norte ${label}`, kind: "sucursal" })
    .returning({ id: sites.id });
  const person = async (
    apellido: string,
    managerId: string | null,
    siteId: string | null = tenant.site.id,
  ) => {
    const [row] = await ownerDb
      .insert(people)
      .values({
        companyId,
        nombres: "Persona",
        apellidoPaterno: apellido,
        curp: uniqueCurp(),
        managerId,
        siteId,
        areaId: tenant.area.id,
      })
      .returning({ id: people.id });
    return row.id;
  };

  const boss = await person(`Jefa${label}`, null);
  const onShift = await person("Alba", boss);
  const left = await person("Bravo", boss);
  const absent = await person("Cano", boss);
  const late = await person("Duran", boss, north.id);
  const pending = await person("Esparza", boss, north.id);
  const indirect = await person("Fuentes", onShift);
  const otherTeam = await person("Gil", null);
  const [account] = await ownerDb
    .insert(employeeAccounts)
    .values({
      companyId,
      personId: boss,
      status: "active",
      email: `${boss}@empleo.test`,
      emailVerifiedAt: new Date(),
      activatedAt: new Date(),
    })
    .returning({ id: employeeAccounts.id });

  // A W2-12 checador that pushed today (last push 08:45) and once yesterday.
  const [device] = await ownerDb
    .insert(attendanceDevices)
    .values({
      companyId,
      name: `Entrada ${label}`,
      csvFormat: DEFAULT_CSV_FORMAT,
    })
    .returning({ id: attendanceDevices.id });
  const yesterday = new Date(new Date(at("12:00")).getTime() - 86_400_000);
  await ownerDb.insert(attendanceBatches).values([
    {
      companyId,
      deviceId: device.id,
      source: "device",
      pushDay: DAY,
      createdAt: new Date(at("07:01")),
      updatedAt: new Date(at("08:45")),
    },
    {
      companyId,
      deviceId: device.id,
      source: "device",
      pushDay: yesterday.toISOString().slice(0, 10),
      createdAt: yesterday,
      updatedAt: yesterday,
    },
  ]);
  const checador = `checador:${device.id}`;

  await writeAttendanceDays(companyId, [
    {
      personId: onShift,
      day: DAY,
      source: checador,
      punches: [{ at: at("08:02"), kind: "in" }],
    },
    {
      personId: left,
      day: DAY,
      source: checador,
      punches: [
        { at: at("07:00"), kind: "in" },
        { at: at("08:30"), kind: "out" },
      ],
    },
    {
      personId: late,
      day: DAY,
      source: "import",
      punches: [{ at: at("09:20"), kind: "in" }],
    },
    // The other team punched later: it must not move this team's cut.
    {
      personId: otherTeam,
      day: DAY,
      source: checador,
      punches: [{ at: at("10:45"), kind: "in" }],
    },
  ]);
  await appendPersonEvents(companyId, [
    incidenciaEvent({
      personId: absent,
      day: DAY,
      kind: "falta",
      period: PERIOD,
      source: "engine",
    }),
    incidenciaEvent({
      personId: late,
      day: DAY,
      kind: "retardo",
      minutes: 20,
      period: PERIOD,
      source: "engine",
    }),
  ]);

  return {
    boss: { personId: boss, accountId: account.id },
    onShift,
    left,
    absent,
    late,
    pending,
    indirect,
    otherTeam,
    northSite: north.id,
    checador,
  };
};

const contextOf = (
  companyId: string,
  member: { personId: string; accountId: string },
) => ({ companyId, ...member, sessionId: "test" });

const mustAccess = async (
  companyId: string,
  member: { personId: string; accountId: string },
): Promise<ManagerAccess> => {
  const access = await getManagerAccess(contextOf(companyId, member));
  if (!access) throw new Error("expected manager access");
  return access;
};

const navigationOf = async (run: () => Promise<unknown>) => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NavigationThrow) return error.kind;
    throw error;
  }
};

beforeAll(async () => {
  a = await seedTenant("TTA");
  b = await seedTenant("TTB");
  teamA = await seedTeam(a, "A");
  teamB = await seedTeam(b, "B");
  await setManagerGrant(a.companyId, teamA.boss.personId, false, a.admin.id);
  await setManagerGrant(b.companyId, teamB.boss.personId, false, b.admin.id);
});

describe("lib:timeline/today with a manager's team", () => {
  it("lists the direct team with each person's state", async () => {
    const access = await mustAccess(a.companyId, teamA.boss);
    const page = await listTodayPage(
      a.companyId,
      { team: access },
      { day: DAY },
    );
    const states = Object.fromEntries(
      page.items.map((row) => [row.personId, todayStatus(row).status]),
    );

    expect(states).toEqual({
      [teamA.onShift]: "on_shift",
      [teamA.left]: "left",
      [teamA.absent]: "absent",
      [teamA.late]: "on_shift",
      [teamA.pending]: "pending",
    });
    const late = page.items.find((row) => row.personId === teamA.late)!;
    expect(todayStatus(late).incidencias).toEqual([
      { kind: "retardo", minutes: 20, justified: false },
    ]);
  });

  it("lib:timeline/today/todayImports", async () => {
    const access = await mustAccess(a.companyId, teamA.boss);

    expect(await todayCounts(a.companyId, { team: access }, DAY)).toEqual({
      roster: 5,
      present: 3,
      absent: 1,
      late: 1,
      leftEarly: 0,
    });
    expect(await todayImports(a.companyId, { team: access }, DAY)).toEqual({
      onShift: 2,
      sources: [
        {
          source: "import",
          deviceName: null,
          people: 1,
          lastPunchAt: stored("09:20"),
          importedAt: null,
        },
        {
          source: teamA.checador,
          deviceName: "Entrada A",
          people: 2,
          lastPunchAt: stored("08:30"),
          importedAt: stored("08:45"),
        },
      ],
    });
  });

  it("narrows to one site of the team", async () => {
    const access = await mustAccess(a.companyId, teamA.boss);
    const scope = { team: access, siteId: teamA.northSite };

    expect(
      (await listTodayPage(a.companyId, scope, { day: DAY })).items.map(
        (row) => row.personId,
      ),
    ).toEqual([teamA.late, teamA.pending]);
    expect(await todayCounts(a.companyId, scope, DAY)).toMatchObject({
      roster: 2,
      present: 1,
      late: 1,
    });
    expect((await todayImports(a.companyId, scope, DAY)).sources).toEqual([
      expect.objectContaining({ source: "import", people: 1 }),
    ]);
  });

  it("includes indirect reports when HR enables them", async () => {
    await setManagerGrant(a.companyId, teamA.boss.personId, true, a.admin.id);
    try {
      const access = await mustAccess(a.companyId, teamA.boss);
      const ids = (
        await listTodayPage(a.companyId, { team: access }, { day: DAY })
      ).items.map((row) => row.personId);

      expect(ids).toContain(teamA.indirect);
      expect(ids).not.toContain(teamA.otherTeam);
    } finally {
      await setManagerGrant(
        a.companyId,
        teamA.boss.personId,
        false,
        a.admin.id,
      );
    }
  });

  it("returns nothing of company A's team to company B", async () => {
    const access = await mustAccess(a.companyId, teamA.boss);

    expect(
      await listTodayPage(b.companyId, { team: access }, { day: DAY }),
    ).toEqual({ items: [], next: null });
    expect(await todayCounts(b.companyId, { team: access }, DAY)).toEqual({
      roster: 0,
      present: 0,
      absent: 0,
      late: 0,
      leftEarly: 0,
    });
    expect(await todayImports(b.companyId, { team: access }, DAY)).toEqual({
      onShift: 0,
      sources: [],
    });
    // A site of company B is not a filter of A's team.
    expect(
      await listTodayPage(
        a.companyId,
        { team: access, siteId: teamB.northSite },
        { day: DAY },
      ),
    ).toEqual({ items: [], next: null });
  });
});

describe("today view load (W2-17)", () => {
  it("answers a team of a hundred under a five-year load in under a second", async () => {
    const run = (query: string, params: unknown[] = []) =>
      ownerDb.$client.query(query, params);
    const bossId = (
      await run(
        `INSERT INTO people (company_id, nombres, apellido_paterno, curp)
         VALUES ($1, 'Jefa', 'Carga', $2) RETURNING id`,
        [a.companyId, uniqueCurp()],
      )
    ).rows[0].id as string;
    const accountId = (
      await run(
        `INSERT INTO employee_accounts (company_id, person_id, status, email, email_verified_at, activated_at)
         VALUES ($1, $2, 'active', $3, now(), now()) RETURNING id`,
        [a.companyId, bossId, `${bossId}@empleo.test`],
      )
    ).rows[0].id as string;
    await run(
      `INSERT INTO people (company_id, nombres, apellido_paterno, site_id, manager_id)
       SELECT $1, 'Carga ' || i, 'Equipo', $2, $3 FROM generate_series(1, 100) i`,
      [a.companyId, a.site.id, bossId],
    );
    // Five years of days with two punches, as the writer stores them.
    await run(
      `INSERT INTO person_events (company_id, person_id, type, occurred_at, source, dedupe_key, payload)
       SELECT p.company_id, p.id, 'attendance', d + time '14:00', 'checador:carga',
              'attendance:' || to_char(d, 'YYYY-MM-DD'),
              jsonb_build_object('punches', jsonb_build_array(
                jsonb_build_array(to_char(d + time '14:00', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'in'),
                jsonb_build_array(to_char(d + time '23:00', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'out')))
       FROM people p, generate_series($2::date - interval '5 years', $2::date, interval '1 day') d
       WHERE p.company_id = $1 AND p.manager_id = $3`,
      [a.companyId, DAY, bossId],
    );
    await run("ANALYZE person_events");
    await run("ANALYZE people");
    await setManagerGrant(a.companyId, bossId, false, a.admin.id);

    employee.context = contextOf(a.companyId, { personId: bossId, accountId });
    const started = performance.now();
    const html = renderToStaticMarkup(
      (await TeamTodayPage({
        searchParams: Promise.resolve({}),
      })) as React.ReactElement,
    );
    const elapsed = performance.now() - started;

    expect(html).toContain("Carga 100");
    expect(html).toContain("Checador carga: último registro a las");
    expect(elapsed).toBeLessThan(1000);
  });
});

describe("lib:managers/listTeamPlaces", () => {
  it("lists only the sites and areas of the team", async () => {
    const access = await mustAccess(a.companyId, teamA.boss);
    const places = await listTeamPlaces(access);

    expect(places.map((place) => place.id).sort()).toEqual(
      [a.site.id, teamA.northSite, a.area.id].sort(),
    );
  });
});

describe("the today screens", () => {
  it("page:/mi/equipo/hoy", async () => {
    const visit = (lugar?: string) =>
      navigationOf(() =>
        TeamTodayPage({
          searchParams: Promise.resolve(lugar ? { lugar } : {}),
        }),
      );

    employee.context = contextOf(a.companyId, teamA.boss);
    const html = renderToStaticMarkup((await visit()) as React.ReactElement);

    expect(html).toContain("Alba");
    expect(html).toContain("Esparza");
    expect(html).not.toContain("Gil");
    expect(html).toContain("Sin registro");
    expect(html).toContain("Retardo 20 min");
    expect(html).toContain("Importación: último registro a las");
    expect(html).toContain("Checador Entrada A: cargado a las");

    // A place of the other company is ignored: the whole team shows.
    const filtered = renderToStaticMarkup(
      (await visit(`site:${teamB.northSite}`)) as React.ReactElement,
    );
    expect(filtered).toContain("Alba");

    const north = renderToStaticMarkup(
      (await visit(`site:${teamA.northSite}`)) as React.ReactElement,
    );
    expect(north).toContain("Duran");
    expect(north).not.toContain("Alba");

    // Not a manager: 404. Signed out: to the sign-in.
    employee.context = contextOf(a.companyId, {
      personId: teamA.onShift,
      accountId: randomUUID(),
    });
    expect(await visit()).toBe("notFound");
    employee.context = null;
    expect(await visit()).toBe("redirect");
  });

  it("drills into a team member's attendance, and nobody else's", async () => {
    employee.context = contextOf(a.companyId, teamA.boss);
    const visit = (personId: string) =>
      navigationOf(() =>
        TeamMemberPage({
          params: Promise.resolve({ personId }),
          searchParams: Promise.resolve({}),
        }),
      );

    const html = renderToStaticMarkup(
      (await visit(teamA.late)) as React.ReactElement,
    );
    expect(html).toContain("Asistencia e incidencias");
    expect(html).toContain("Retardo");
    expect(html).toContain("20 min");
    expect(html).toContain("Importación");

    expect(await visit(teamA.otherTeam)).toBe("notFound");
    expect(await visit(teamB.late)).toBe("notFound");
  });
});
