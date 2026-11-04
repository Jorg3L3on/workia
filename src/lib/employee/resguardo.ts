import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { recordAuditEvent } from "@/lib/audit";
import { tdb, withTransaction } from "@/lib/db";
import { assetMovements, assets } from "@/lib/db/schema";
import type { EmployeeContext } from "@/lib/employee-accounts/sign-in";
import { withTenant } from "@/lib/tenant/scope";

/**
 * Resguardo in the employee app (Workia 2.0 W2-11): the assets the person
 * holds today, each with the entrega that gave it to them, and the employee's
 * acceptance of that entrega. An acceptance is a click recorded with the
 * employee account and the time, not an e-signature. Company and person come
 * from the employee session only.
 */

export type EmployeeResguardoItem = {
  assetId: string;
  name: string;
  identifier: string;
  category: string;
  conditionNote: string | null;
  /** The entrega to this person that the asset is held under; null for a consumable with no history. */
  movementId: string | null;
  deliveredOn: string | null;
  deliveryNote: string | null;
  acceptedAt: Date | null;
};

/** Assets the employee holds now, with the latest entrega to them. */
export const listEmployeeResguardo = async (
  context: EmployeeContext,
): Promise<EmployeeResguardoItem[]> => {
  const held = await tdb(context.companyId)
    .select({
      assetId: assets.id,
      name: assets.name,
      identifier: assets.identifier,
      category: assets.category,
      conditionNote: assets.conditionNote,
    })
    .from(assets)
    .where(
      withTenant(
        assets,
        context.companyId,
        eq(assets.holderId, context.personId),
        eq(assets.status, "asignado"),
        isNull(assets.deletedAt),
      ),
    )
    .orderBy(assets.name);

  if (held.length === 0) {
    return [];
  }

  const movements = await tdb(context.companyId)
    .select({
      id: assetMovements.id,
      assetId: assetMovements.assetId,
      movementDate: assetMovements.movementDate,
      conditionNote: assetMovements.conditionNote,
      acceptedAt: assetMovements.acceptedAt,
    })
    .from(assetMovements)
    .where(
      withTenant(
        assetMovements,
        context.companyId,
        eq(assetMovements.personId, context.personId),
        eq(assetMovements.type, "entrega"),
        inArray(
          assetMovements.assetId,
          held.map((asset) => asset.assetId),
        ),
      ),
    )
    .orderBy(desc(assetMovements.movementDate), desc(assetMovements.createdAt));

  return held.map((asset) => {
    const entrega = movements.find((row) => row.assetId === asset.assetId);

    return {
      ...asset,
      movementId: entrega?.id ?? null,
      deliveredOn: entrega?.movementDate ?? null,
      deliveryNote: entrega?.conditionNote ?? null,
      acceptedAt: entrega?.acceptedAt ?? null,
    };
  });
};

/** What the employee reads when an acceptance does not go through. */
export const RESGUARDO_COPY = {
  notFound:
    "Este resguardo ya no está a tu nombre. Recarga la página o pregunta a RH.",
  alreadyAccepted: "Ya habías aceptado este resguardo.",
} as const;

export type AcceptResguardoResult =
  | { ok: true; acceptedAt: Date }
  | { ok: false; reason: "not_found" | "already_accepted" };

/**
 * Accepts the entrega `movementId` for the signed-in employee. Only the
 * current entrega of an asset the person still holds; another person's, a
 * returned asset's or an older entrega is not_found. Accepting twice keeps
 * the first time.
 */
export const acceptEmployeeResguardo = async (
  context: EmployeeContext,
  movementId: string,
): Promise<AcceptResguardoResult> => {
  const current = (await listEmployeeResguardo(context)).find(
    (item) => item.movementId === movementId,
  );

  if (!current) {
    return { ok: false, reason: "not_found" };
  }

  if (current.acceptedAt) {
    return { ok: false, reason: "already_accepted" };
  }

  return withTransaction(async (tx) => {
    const [updated] = await tx
      .update(assetMovements)
      .set({
        acceptedAt: sql`now()`,
        acceptedByEmployeeAccountId: context.accountId,
      })
      .where(
        withTenant(
          assetMovements,
          context.companyId,
          and(
            eq(assetMovements.id, movementId),
            eq(assetMovements.personId, context.personId),
            eq(assetMovements.type, "entrega"),
            isNull(assetMovements.acceptedAt),
            // Still held: a return between the read and this write wins.
            sql`exists (select 1 from ${assets} where ${assets.companyId} = ${assetMovements.companyId} and ${assets.id} = ${assetMovements.assetId} and ${assets.holderId} = ${context.personId} and ${assets.status} = 'asignado' and ${assets.deletedAt} is null)`,
          ),
        ),
      )
      .returning({
        id: assetMovements.id,
        acceptedAt: assetMovements.acceptedAt,
      });

    if (!updated?.acceptedAt) {
      return { ok: false, reason: "already_accepted" } as const;
    }

    await recordAuditEvent(
      {
        companyId: context.companyId,
        actorEmployeeAccountId: context.accountId,
        resourceType: "asset_movement",
        resourceId: updated.id,
        action: "accept",
        payload: {
          summary: `Resguardo aceptado: ${current.name} (${current.identifier})`,
          after: { acceptedAt: updated.acceptedAt.toISOString() },
        },
      },
      tx,
    );

    return { ok: true, acceptedAt: updated.acceptedAt } as const;
  }, context.companyId);
};
