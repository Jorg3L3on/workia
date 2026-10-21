/**
 * Saved views of Personas (Iniciativa 3): a view is read only by its owner,
 * or by members of the same company when shared; only the owner changes it;
 * payroll columns are dropped when read by someone without compensation:read.
 * Test titles are the surface ids of docs/idor-matrix.md.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { peopleViews } from "@/lib/db/schema";
import {
  createPeopleView,
  deletePeopleView,
  getPeopleView,
  listPeopleViews,
  updatePeopleView,
  type PeopleViewActor,
} from "@/lib/people/views";
import {
  createPeopleViewAction,
  deletePeopleViewAction,
  updatePeopleViewAction,
} from "@/lib/people/views/actions";

import { ownerDb, seedTenant, type Tenant } from "./fixtures";
import { actAs } from "./session-state";

let a: Tenant;
let b: Tenant;
let sharedA: string;
let privateA: string;

const ADMIN = new Set(["people:read", "contracts:read", "compensation:read"]);
const EDITOR = new Set(["people:read", "contracts:read"]);
const VIEWER = new Set(["people:read"]);
const actor = (
  user: { id: string },
  permissions: ReadonlySet<string> = ADMIN,
): PeopleViewActor => ({ userId: user.id, permissions });

const input = (overrides: Record<string, unknown> = {}) => ({
  name: "Contratos por vencer",
  shared: true,
  filter: {
    q: "",
    deleted: false,
    conditions: [
      { field: "vence", op: "next_days", days: 30 },
      { field: "relacion", op: "is", values: ["activa"] },
    ],
  },
  columns: ["rfc", "finContrato", "salarioDiario"],
  ...overrides,
});

const viewRow = async (id: string) =>
  (await ownerDb.select().from(peopleViews).where(eq(peopleViews.id, id)))[0];

beforeAll(async () => {
  a = await seedTenant("VA");
  b = await seedTenant("VB");
  sharedA = (await createPeopleView(a.companyId, actor(a.admin), input()))!.id;
  privateA = (await createPeopleView(
    a.companyId,
    actor(a.admin),
    input({ name: "Mías", shared: false }),
  ))!.id;
});

describe("saved views", () => {
  it("stores what the owner chose and filters on read", async () => {
    const stored = await viewRow(sharedA);
    expect(stored.columns).toEqual(["rfc", "finContrato", "salarioDiario"]);

    const asEditor = await getPeopleView(
      a.companyId,
      actor(a.editor, EDITOR),
      sharedA,
    );
    expect(asEditor?.columns).toEqual(["rfc", "finContrato"]);
    expect(asEditor?.filter.conditions).toHaveLength(2);

    const asViewer = await getPeopleView(
      a.companyId,
      actor(a.viewer, VIEWER),
      sharedA,
    );
    expect(asViewer?.columns).toEqual(["rfc"]);
    // The contract condition needs contracts:read too.
    expect(asViewer?.filter.conditions).toEqual([
      { field: "relacion", op: "is", values: ["activa"] },
    ]);
    expect(asViewer?.isOwner).toBe(false);
  });

  it("shows a shared view to the company, a personal one only to its owner", async () => {
    const mine = await listPeopleViews(a.companyId, actor(a.admin));
    expect(mine.map((view) => view.id)).toEqual(
      expect.arrayContaining([sharedA, privateA]),
    );

    const colleague = await listPeopleViews(a.companyId, actor(a.viewer));
    expect(colleague.map((view) => view.id)).toEqual([sharedA]);
    expect(
      await getPeopleView(a.companyId, actor(a.viewer), privateA),
    ).toBeNull();
  });

  it("lets only the owner change or delete a view", async () => {
    expect(
      await updatePeopleView(
        a.companyId,
        actor(a.viewer),
        sharedA,
        input({ name: "Robada" }),
      ),
    ).toBeNull();
    expect(await deletePeopleView(a.companyId, actor(a.viewer), sharedA)).toBe(
      false,
    );
    expect((await viewRow(sharedA)).name).toBe("Contratos por vencer");
  });
});

describe("views stay inside the company", () => {
  it("lib:people/views/listPeopleViews", async () => {
    const views = await listPeopleViews(b.companyId, actor(b.admin));
    expect(views.map((view) => view.id)).not.toContain(sharedA);
    // Even A's own admin sees nothing of A from B's company.
    expect(await listPeopleViews(b.companyId, actor(a.admin))).toEqual([]);
  });

  it("lib:people/views/getPeopleView", async () => {
    expect(
      await getPeopleView(b.companyId, actor(b.admin), sharedA),
    ).toBeNull();
    expect(
      await getPeopleView(b.companyId, actor(a.admin), sharedA),
    ).toBeNull();
  });

  it("lib:people/views/createPeopleView", async () => {
    const view = await createPeopleView(
      b.companyId,
      actor(b.admin),
      input({ name: "Vista B" }),
    );
    expect((await viewRow(view!.id)).companyId).toBe(b.companyId);
    expect(
      await getPeopleView(a.companyId, actor(a.admin), view!.id),
    ).toBeNull();
  });

  it("lib:people/views/updatePeopleView", async () => {
    // A's owner, through B's company: not found.
    expect(
      await updatePeopleView(
        b.companyId,
        actor(a.admin),
        sharedA,
        input({ name: "Cruzada" }),
      ),
    ).toBeNull();
    expect((await viewRow(sharedA)).name).toBe("Contratos por vencer");
  });

  it("lib:people/views/deletePeopleView", async () => {
    expect(await deletePeopleView(b.companyId, actor(a.admin), sharedA)).toBe(
      false,
    );
    expect(await viewRow(sharedA)).toBeDefined();
  });

  it("action:people/createPeopleViewAction", async () => {
    actAs(b.viewer);
    const result = await createPeopleViewAction(input({ name: "De B" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((await viewRow(result.view.id)).companyId).toBe(b.companyId);
      // The viewer role has no compensation:read: no salary on read.
      expect(result.view.columns).not.toContain("salarioDiario");
      expect((await viewRow(result.view.id)).columns).toContain(
        "salarioDiario",
      );
    }

    actAs(null);
    expect((await createPeopleViewAction(input())).ok).toBe(false);
    expect((await createPeopleViewAction(input({ name: "   " }))).ok).toBe(
      false,
    );
  });

  it("action:people/updatePeopleViewAction", async () => {
    actAs(b.admin);
    const result = await updatePeopleViewAction(
      sharedA,
      input({ name: "Cruzada" }),
    );
    expect(result.ok).toBe(false);
    expect((await viewRow(sharedA)).name).toBe("Contratos por vencer");

    actAs(a.admin);
    const own = await updatePeopleViewAction(
      privateA,
      input({ name: "Mías 2", shared: false }),
    );
    expect(own.ok && own.view.name).toBe("Mías 2");
  });

  it("action:people/deletePeopleViewAction", async () => {
    actAs(b.admin);
    expect((await deletePeopleViewAction(sharedA)).ok).toBe(false);
    expect((await deletePeopleViewAction("no-es-uuid")).ok).toBe(false);
    expect(await viewRow(sharedA)).toBeDefined();

    actAs(a.admin);
    expect((await deletePeopleViewAction(privateA)).ok).toBe(true);
    expect(await viewRow(privateA)).toBeUndefined();
  });
});
