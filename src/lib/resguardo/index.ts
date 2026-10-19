import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotAsset,
  snapshotAssetMovement,
} from "@/lib/audit";
import { tdb } from "@/lib/db";
import { rethrowDuplicate } from "@/lib/db/errors";
import { withTenant } from "@/lib/tenant/scope";
import { escapeLike } from "@/lib/db/like";
import { assetMovements, assets, people } from "@/lib/db/schema";
import { formatPersonName } from "@/lib/people/schema";

import type {
  AssetFormValues,
  AssignAssetFormValues,
  ReturnAssetFormValues,
} from "./schema";

export type AssetListItem = {
  id: string;
  name: string;
  identifier: string;
  category: string;
  tracksHistory: boolean;
  status: (typeof assets.$inferSelect)["status"];
  holderId: string | null;
  holderName: string | null;
  conditionNote: string | null;
};

export type AssetWithHolder = typeof assets.$inferSelect & {
  holder: {
    id: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  } | null;
};

export type AssetMovementWithPerson = typeof assetMovements.$inferSelect & {
  person: {
    id: string;
    nombres: string;
    apellidoPaterno: string;
    apellidoMaterno: string | null;
  };
};

export type PersonAssetItem = {
  id: string;
  name: string;
  identifier: string;
  category: string;
  conditionNote: string | null;
  tracksHistory: boolean;
};

const buildAssetListSelect = (companyId: string) =>
  tdb(companyId)
    .select({
      id: assets.id,
      name: assets.name,
      identifier: assets.identifier,
      category: assets.category,
      tracksHistory: assets.tracksHistory,
      status: assets.status,
      holderId: assets.holderId,
      conditionNote: assets.conditionNote,
      holderNombres: people.nombres,
      holderApellidoPaterno: people.apellidoPaterno,
      holderApellidoMaterno: people.apellidoMaterno,
    })
    .from(assets)
    .leftJoin(people, eq(assets.holderId, people.id));

export const listAssetsPage = async (
  companyId: string,
  options: {
    query?: string;
    status?: (typeof assets.$inferSelect)["status"];
    includeDeleted?: boolean;
    page: number;
    pageSize: number;
  },
) => {
  const filters: (SQL | undefined)[] = [eq(assets.companyId, companyId)];

  if (!options?.includeDeleted) {
    filters.push(isNull(assets.deletedAt));
  }

  if (options?.status) {
    filters.push(eq(assets.status, options.status));
  }

  if (options?.query?.trim()) {
    const term = `%${escapeLike(options.query.trim())}%`;
    filters.push(
      or(
        ilike(assets.name, term),
        ilike(assets.identifier, term),
        ilike(assets.category, term),
      ),
    );
  }

  const where = and(...filters);

  const [rows, [totals]] = await Promise.all([
    buildAssetListSelect(companyId)
      .where(where)
      .orderBy(asc(assets.name), asc(assets.id))
      .limit(options.pageSize)
      .offset((options.page - 1) * options.pageSize),
    tdb(companyId).select({ total: count() }).from(assets).where(where),
  ]);

  const items = rows.map((row): AssetListItem => ({
    id: row.id,
    name: row.name,
    identifier: row.identifier,
    category: row.category,
    tracksHistory: row.tracksHistory,
    status: row.status,
    holderId: row.holderId,
    conditionNote: row.conditionNote,
    holderName: row.holderId
      ? formatPersonName({
          nombres: row.holderNombres ?? "",
          apellidoPaterno: row.holderApellidoPaterno ?? "",
          apellidoMaterno: row.holderApellidoMaterno,
        })
      : null,
  }));

  return { items, total: totals?.total ?? 0 };
};

export const getAssetById = async (companyId: string, id: string) => {
  const [asset] = await tdb(companyId)
    .select()
    .from(assets)
    .where(
      withTenant(
        assets,
        companyId,
        eq(assets.id, id),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  return asset ?? null;
};

export const getAssetWithHolder = async (companyId: string, id: string) => {
  const [row] = await tdb(companyId)
    .select({
      asset: assets,
      holderId: people.id,
      holderNombres: people.nombres,
      holderApellidoPaterno: people.apellidoPaterno,
      holderApellidoMaterno: people.apellidoMaterno,
    })
    .from(assets)
    .leftJoin(people, eq(assets.holderId, people.id))
    .where(
      withTenant(
        assets,
        companyId,
        eq(assets.id, id),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    ...row.asset,
    holder: row.holderId
      ? {
          id: row.holderId,
          nombres: row.holderNombres ?? "",
          apellidoPaterno: row.holderApellidoPaterno ?? "",
          apellidoMaterno: row.holderApellidoMaterno,
        }
      : null,
  } satisfies AssetWithHolder;
};

export const listAssetMovements = async (
  companyId: string,
  assetId: string,
) => {
  const rows = await tdb(companyId)
    .select({
      movement: assetMovements,
      personId: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(assetMovements)
    .innerJoin(people, eq(assetMovements.personId, people.id))
    .where(
      withTenant(
        assetMovements,
        companyId,
        eq(assetMovements.assetId, assetId),
      ),
    )
    .orderBy(desc(assetMovements.movementDate), desc(assetMovements.createdAt));

  return rows.map((row): AssetMovementWithPerson => ({
    ...row.movement,
    person: {
      id: row.personId,
      nombres: row.nombres,
      apellidoPaterno: row.apellidoPaterno,
      apellidoMaterno: row.apellidoMaterno,
    },
  }));
};

export const listAssetsByPerson = async (
  companyId: string,
  personId: string,
) => {
  const rows = await tdb(companyId)
    .select({
      id: assets.id,
      name: assets.name,
      identifier: assets.identifier,
      category: assets.category,
      conditionNote: assets.conditionNote,
      tracksHistory: assets.tracksHistory,
    })
    .from(assets)
    .where(
      withTenant(
        assets,
        companyId,
        eq(assets.holderId, personId),
        eq(assets.status, "asignado"),
        isNull(assets.deletedAt),
      ),
    )
    .orderBy(asc(assets.name));

  return rows satisfies PersonAssetItem[];
};

export const createAsset = async (
  companyId: string,
  input: AssetFormValues,
  actorUserId: string,
) => {
  const [created] = await tdb(companyId)
    .insert(assets)
    .values({
      companyId,
      name: input.name.trim(),
      identifier: input.identifier.trim(),
      category: input.category.trim(),
      tracksHistory: input.tracksHistory,
      status: "disponible",
    })
    .returning()
    .catch(rethrowDuplicate("Ya existe un activo con ese identificador."));

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "asset",
    resourceId: created.id,
    action: "create",
    payload: {
      summary: `Activo registrado: ${created.name} (${created.identifier})`,
      after: snapshotAsset(created),
    },
  });

  return created;
};

export const assignAsset = async (
  companyId: string,
  input: AssignAssetFormValues,
  actorUserId: string,
) => {
  const asset = await getAssetById(companyId, input.assetId);

  if (!asset) {
    throw new Error("Activo no encontrado.");
  }

  if (!asset.tracksHistory) {
    throw new Error("Este activo no admite historial de entregas.");
  }

  if (asset.status === "asignado" && asset.holderId) {
    throw new Error(
      "El activo ya está asignado. Registra la devolución primero.",
    );
  }

  if (asset.status === "baja") {
    throw new Error("No se puede asignar un activo dado de baja.");
  }

  const [person] = await tdb(companyId)
    .select({ id: people.id })
    .from(people)
    .where(
      withTenant(
        people,
        companyId,
        eq(people.id, input.personId),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);

  if (!person) {
    throw new Error("Persona no encontrada.");
  }

  const [movement] = await tdb(companyId)
    .insert(assetMovements)
    .values({
      companyId,
      assetId: asset.id,
      type: "entrega",
      personId: input.personId,
      movementDate: input.movementDate,
      conditionNote: input.conditionNote.trim(),
      notes: input.notes?.trim() || null,
    })
    .returning();

  const [updated] = await tdb(companyId)
    .update(assets)
    .set({
      holderId: input.personId,
      conditionNote: input.conditionNote.trim(),
      status: "asignado",
    })
    .where(withTenant(assets, companyId, eq(assets.id, asset.id)))
    .returning();

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "asset_movement",
    resourceId: movement.id,
    action: "assign",
    payload: {
      summary: `Entrega: ${asset.name} → persona ${input.personId}`,
      after: snapshotAssetMovement(movement),
    },
  });

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "asset",
    resourceId: asset.id,
    action: "update",
    payload: {
      summary: `Activo asignado: ${asset.name}`,
      before: snapshotAsset(asset),
      after: snapshotAsset(updated),
      changes: buildChanges(snapshotAsset(asset), snapshotAsset(updated), [
        "holderId",
        "conditionNote",
        "status",
      ]),
    },
  });

  return { asset: updated, movement };
};

export const returnAsset = async (
  companyId: string,
  input: ReturnAssetFormValues,
  actorUserId: string,
) => {
  const asset = await getAssetById(companyId, input.assetId);

  if (!asset) {
    throw new Error("Activo no encontrado.");
  }

  if (!asset.tracksHistory) {
    throw new Error("Este activo no admite historial de devoluciones.");
  }

  if (asset.status !== "asignado" || !asset.holderId) {
    throw new Error("El activo no está asignado.");
  }

  const holderId = asset.holderId;

  const [movement] = await tdb(companyId)
    .insert(assetMovements)
    .values({
      companyId,
      assetId: asset.id,
      type: "devolucion",
      personId: holderId,
      movementDate: input.movementDate,
      conditionNote: input.conditionNote.trim(),
      notes: input.notes?.trim() || null,
    })
    .returning();

  const [updated] = await tdb(companyId)
    .update(assets)
    .set({
      holderId: null,
      conditionNote: input.conditionNote.trim(),
      status: "disponible",
    })
    .where(withTenant(assets, companyId, eq(assets.id, asset.id)))
    .returning();

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "asset_movement",
    resourceId: movement.id,
    action: "return",
    payload: {
      summary: `Devolución: ${asset.name} ← persona ${holderId}`,
      after: snapshotAssetMovement(movement),
    },
  });

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "asset",
    resourceId: asset.id,
    action: "update",
    payload: {
      summary: `Activo devuelto al almacén: ${asset.name}`,
      before: snapshotAsset(asset),
      after: snapshotAsset(updated),
      changes: buildChanges(snapshotAsset(asset), snapshotAsset(updated), [
        "holderId",
        "conditionNote",
        "status",
      ]),
    },
  });

  return { asset: updated, movement };
};

export const softDeleteAsset = async (
  companyId: string,
  id: string,
  actorUserId: string,
) => {
  const existing = await getAssetById(companyId, id);

  if (!existing) {
    throw new Error("Activo no encontrado.");
  }

  if (existing.status === "asignado") {
    throw new Error("Devuelve el activo antes de darlo de baja.");
  }

  const deletedAt = new Date();

  const [updated] = await tdb(companyId)
    .update(assets)
    .set({ deletedAt, status: "baja" })
    .where(withTenant(assets, companyId, eq(assets.id, id)))
    .returning();

  await recordAuditEvent({
    companyId,
    actorUserId,
    resourceType: "asset",
    resourceId: id,
    action: "delete",
    payload: {
      summary: `Activo dado de baja: ${existing.name}`,
      before: snapshotAsset(existing),
      after: snapshotAsset(updated),
    },
  });

  return updated;
};

export const countAssignedAssets = async (companyId: string) => {
  const rows = await tdb(companyId)
    .select({ id: assets.id })
    .from(assets)
    .where(
      withTenant(
        assets,
        companyId,
        eq(assets.status, "asignado"),
        isNull(assets.deletedAt),
        eq(assets.tracksHistory, true),
      ),
    );

  return rows.length;
};

/**
 * Assets in a stable order (name, id) for cursor paging, with the current
 * holder and since when they hold it. Read only; used by the MCP list_assets.
 */
export const listAssetsKeyset = async (
  companyId: string,
  options: {
    query?: string;
    status?: (typeof assets.$inferSelect)["status"];
    category?: string;
    holderId?: string;
    after?: { key: string; id: string } | null;
    limit: number;
  },
) => {
  const filters: (SQL | undefined)[] = [
    eq(assets.companyId, companyId),
    isNull(assets.deletedAt),
    options.status ? eq(assets.status, options.status) : undefined,
    options.category
      ? ilike(assets.category, escapeLike(options.category.trim()))
      : undefined,
    options.holderId ? eq(assets.holderId, options.holderId) : undefined,
    options.after
      ? sql`(${assets.name}, ${assets.id}) > (${options.after.key}, ${options.after.id}::uuid)`
      : undefined,
  ];

  if (options.query?.trim()) {
    const term = `%${escapeLike(options.query.trim())}%`;
    filters.push(
      or(
        ilike(assets.name, term),
        ilike(assets.identifier, term),
        ilike(assets.category, term),
      ),
    );
  }

  return tdb(companyId)
    .select({
      id: assets.id,
      name: assets.name,
      identifier: assets.identifier,
      category: assets.category,
      status: assets.status,
      conditionNote: assets.conditionNote,
      holderId: assets.holderId,
      holderNombres: people.nombres,
      holderApellidoPaterno: people.apellidoPaterno,
      holderApellidoMaterno: people.apellidoMaterno,
      since: sql<
        string | null
      >`(select max(m.movement_date)::text from ${assetMovements} m where m.asset_id = ${assets.id} and m.company_id = ${assets.companyId} and m.type = 'entrega' and m.person_id = ${assets.holderId})`,
    })
    .from(assets)
    .leftJoin(people, eq(assets.holderId, people.id))
    .where(and(...filters))
    .orderBy(asc(assets.name), asc(assets.id))
    .limit(options.limit + 1);
};

export type AssetToRecover = {
  id: string;
  name: string;
  identifier: string;
  holderName: string;
};

/**
 * «Equipo pendiente» on Inicio: assets still assigned to someone who is no
 * longer active (baja or deleted expediente), so HR has to get them back.
 */
export const listAssetsToRecover = async (
  companyId: string,
  limit = 5,
): Promise<{ items: AssetToRecover[]; total: number }> => {
  const where = and(
    eq(assets.companyId, companyId),
    eq(assets.status, "asignado"),
    isNull(assets.deletedAt),
    or(eq(people.status, "baja"), sql`${people.deletedAt} is not null`),
  );

  const [rows, [totals]] = await Promise.all([
    tdb(companyId)
      .select({
        id: assets.id,
        name: assets.name,
        identifier: assets.identifier,
        nombres: people.nombres,
        apellidoPaterno: people.apellidoPaterno,
        apellidoMaterno: people.apellidoMaterno,
      })
      .from(assets)
      .innerJoin(people, eq(assets.holderId, people.id))
      .where(where)
      .orderBy(asc(assets.name), asc(assets.id))
      .limit(limit),
    tdb(companyId)
      .select({ total: count() })
      .from(assets)
      .innerJoin(people, eq(assets.holderId, people.id))
      .where(where),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      identifier: row.identifier,
      holderName: formatPersonName(row),
    })),
    total: totals?.total ?? 0,
  };
};
