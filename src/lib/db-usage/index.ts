import { env } from "@/env";
import { logger } from "@/lib/logger";

import { readDatabaseSize } from "./database";
import {
  assessUsage,
  worstLevel,
  type UsageLevel,
  type UsageMetric,
} from "./limits";
import {
  fetchNeonUsage,
  readNeonApiConfig,
  type NeonProjectUsage,
} from "./neon-api";

export {
  readLargestTables,
  readSlowQueries,
  type SlowQueryReport,
  type TableSize,
} from "./database";
export * from "./limits";

export type DatabaseUsage = {
  metrics: UsageMetric[];
  level: UsageLevel;
  /** "neon" when compute and egress come from the Neon API. */
  source: "neon" | "postgres";
  /** Why the Neon API was not used, when it was not. */
  neonNote: string | null;
  periodStart: Date | null;
  measuredAt: Date;
};

/**
 * How long one reading is reused. Usage moves slowly, and every reading from
 * Postgres is a query on the free compute, so the app reads at most once per
 * window per server instance.
 */
export const USAGE_CACHE_MS = 10 * 60 * 1000;

let cached: { at: number; value: Promise<DatabaseUsage> } | null = null;

const measure = async (): Promise<DatabaseUsage> => {
  const config = readNeonApiConfig({
    NEON_API_KEY: env.NEON_API_KEY,
    NEON_PROJECT_ID: env.NEON_PROJECT_ID,
  });
  let neon: NeonProjectUsage | null = null;
  let neonNote: string | null = null;

  if (!config) {
    neonNote =
      "El cómputo y la transferencia del mes se muestran al configurar NEON_API_KEY y NEON_PROJECT_ID.";
  } else {
    try {
      neon = await fetchNeonUsage(config);
    } catch (error) {
      logger.warn({ err: error }, "db-usage: Neon API unavailable");
      neonNote =
        "No se pudo consultar la API de Neon; se muestra solo el tamaño de la base de datos.";
    }
  }

  // The Free cap counts the logical size of every branch; without the API
  // the size of this database is the closest reading.
  const storageBytes =
    neon && neon.storageBytes > 0
      ? neon.storageBytes
      : await readDatabaseSize();

  const metrics = assessUsage({
    storageBytes,
    computeCuHours: neon?.computeCuHours ?? null,
    egressBytes: neon?.egressBytes ?? null,
    branches: neon?.branches ?? null,
  });

  return {
    metrics,
    level: worstLevel(metrics.map((metric) => metric.level)),
    source: neon ? "neon" : "postgres",
    neonNote,
    periodStart: neon?.periodStart ?? null,
    measuredAt: new Date(),
  };
};

/** Usage against the Neon Free limits, reused for USAGE_CACHE_MS. */
export const getDatabaseUsage = (
  options: { fresh?: boolean } = {},
): Promise<DatabaseUsage> => {
  const now = Date.now();

  if (!options.fresh && cached && now - cached.at < USAGE_CACHE_MS) {
    return cached.value;
  }

  const value = measure();
  cached = { at: now, value };
  // A failed reading is not kept: the next request tries again.
  value.catch(() => {
    if (cached?.value === value) cached = null;
  });

  return value;
};

/** Never throws: pages that only show a warning skip it when usage fails. */
export const getDatabaseUsageOrNull = async () => {
  try {
    return await getDatabaseUsage();
  } catch (error) {
    logger.warn({ err: error }, "db-usage: reading failed");
    return null;
  }
};
