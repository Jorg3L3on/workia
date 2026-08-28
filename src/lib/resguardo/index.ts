import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";

import {
  buildChanges,
  recordAuditEvent,
  snapshotAsset,
  snapshotAssetMovement,
} from "@/lib/audit";
import { db } from "@/lib/db";
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

const buildAssetListSelect = () =>
  db
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

export const listAssets = async (options?: {
  query?: string;
  status?: (typeof assets.$inferSelect)["status"];
  includeDeleted?: boolean;
}) => {
  const filters = [];

  if (!options?.includeDeleted) {
    filters.push(isNull(assets.deletedAt));
  }

  if (options?.status) {
    filters.push(eq(assets.status, options.status));
  }

  if (options?.query?.trim()) {
    const term = `%${options.query.trim()}%`;
    filters.push(
      or(
        ilike(assets.name, term),
        ilike(assets.identifier, term),
        ilike(assets.category, term),
      ),
    );
  }

  const rows = await buildAssetListSelect()
    .where(filters.length === 0 ? undefined : and(...filters))
    .orderBy(asc(assets.name));

  return rows.map((row): AssetListItem => ({
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
};

export const getAssetById = async (id: string) => {
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, id), isNull(assets.deletedAt)))
    .limit(1);

  return asset ?? null;
};

export const getAssetWithHolder = async (id: string) => {
  const [row] = await db
    .select({
      asset: assets,
      holderId: people.id,
      holderNombres: people.nombres,
      holderApellidoPaterno: people.apellidoPaterno,
      holderApellidoMaterno: people.apellidoMaterno,
    })
    .from(assets)
    .leftJoin(people, eq(assets.holderId, people.id))
    .where(and(eq(assets.id, id), isNull(assets.deletedAt)))
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

export const listAssetMovements = async (assetId: string) => {
  const rows = await db
    .select({
      movement: assetMovements,
      personId: people.id,
      nombres: people.nombres,
      apellidoPaterno: people.apellidoPaterno,
      apellidoMaterno: people.apellidoMaterno,
    })
    .from(assetMovements)
    .innerJoin(people, eq(assetMovements.personId, people.id))
    .where(eq(assetMovements.assetId, assetId))
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

export const listAssetsByPerson = async (personId: string) => {
  const rows = await db
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
      and(
        eq(assets.holderId, personId),
        eq(assets.status, "asignado"),
        isNull(assets.deletedAt),
      ),
    )
    .orderBy(asc(assets.name));

  return rows satisfies PersonAssetItem[];
};

export const createAsset = async (
  input: AssetFormValues,
  actorUserId: string,
) => {
  const [created] = await db
    .insert(assets)
    .values({
      name: input.name.trim(),
      identifier: input.identifier.trim(),
      category: input.category.trim(),
      tracksHistory: input.tracksHistory,
      status: "disponible",
    })
    .returning();

  await recordAuditEvent({
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
  input: AssignAssetFormValues,
  actorUserId: string,
) => {
  const asset = await getAssetById(input.assetId);

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

  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, input.personId), isNull(people.deletedAt)))
    .limit(1);

  if (!person) {
    throw new Error("Persona no encontrada.");
  }

  const [movement] = await db
    .insert(assetMovements)
    .values({
      assetId: asset.id,
      type: "entrega",
      personId: input.personId,
      movementDate: input.movementDate,
      conditionNote: input.conditionNote.trim(),
      notes: input.notes?.trim() || null,
    })
    .returning();

  const [updated] = await db
    .update(assets)
    .set({
      holderId: input.personId,
      conditionNote: input.conditionNote.trim(),
      status: "asignado",
    })
    .where(eq(assets.id, asset.id))
    .returning();

  await recordAuditEvent({
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
  input: ReturnAssetFormValues,
  actorUserId: string,
) => {
  const asset = await getAssetById(input.assetId);

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

  const [movement] = await db
    .insert(assetMovements)
    .values({
      assetId: asset.id,
      type: "devolucion",
      personId: holderId,
      movementDate: input.movementDate,
      conditionNote: input.conditionNote.trim(),
      notes: input.notes?.trim() || null,
    })
    .returning();

  const [updated] = await db
    .update(assets)
    .set({
      holderId: null,
      conditionNote: input.conditionNote.trim(),
      status: "disponible",
    })
    .where(eq(assets.id, asset.id))
    .returning();

  await recordAuditEvent({
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

export const softDeleteAsset = async (id: string, actorUserId: string) => {
  const existing = await getAssetById(id);

  if (!existing) {
    throw new Error("Activo no encontrado.");
  }

  if (existing.status === "asignado") {
    throw new Error("Devuelve el activo antes de darlo de baja.");
  }

  const deletedAt = new Date();

  const [updated] = await db
    .update(assets)
    .set({ deletedAt, status: "baja" })
    .where(eq(assets.id, id))
    .returning();

  await recordAuditEvent({
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

export const countAssignedAssets = async () => {
  const rows = await db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.status, "asignado"),
        isNull(assets.deletedAt),
        eq(assets.tracksHistory, true),
      ),
    );

  return rows.length;
};
