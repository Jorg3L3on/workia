/**
 * Neon Free plan limits (Workia 2.0, P-03). They are design inputs, not
 * settings: the plan is Jorge's and agents never change it. When a limit
 * changes on Neon's side, change it here.
 *
 * Neon counts in decimal units (1 GB = 10^9 bytes). When CU-hours or egress
 * run out, compute is suspended until the next billing period; above the
 * storage limit, writes that grow storage fail.
 */
export const NEON_FREE_LIMITS = {
  /** Logical size summed over every branch of the project. */
  storageBytes: 1_000_000_000,
  /** Compute per project per billing period, in CU-hours. */
  computeCuHours: 100,
  /** Data transfer out per billing period. */
  egressBytes: 5_000_000_000,
  branches: 10,
  restoreHistoryHours: 6,
} as const;

/** From this share of a limit HR admins see a warning. */
export const WARN_RATIO = 0.8;
/** From this share the warning turns urgent. */
export const CRITICAL_RATIO = 0.95;

export type UsageLevel = "ok" | "warn" | "critical";

export type UsageMetricKey = "storage" | "compute" | "egress" | "branches";

export type UsageMetric = {
  key: UsageMetricKey;
  label: string;
  used: number;
  limit: number;
  ratio: number;
  level: UsageLevel;
  /** Human readable, in Spanish: "412 MB de 1 GB". */
  summary: string;
};

export const levelFor = (ratio: number): UsageLevel => {
  if (ratio >= CRITICAL_RATIO) return "critical";
  if (ratio >= WARN_RATIO) return "warn";
  return "ok";
};

const LEVEL_ORDER: Record<UsageLevel, number> = { ok: 0, warn: 1, critical: 2 };

export const worstLevel = (levels: UsageLevel[]): UsageLevel =>
  levels.reduce<UsageLevel>(
    (worst, level) => (LEVEL_ORDER[level] > LEVEL_ORDER[worst] ? level : worst),
    "ok",
  );

const decimal = (value: number, digits: number) =>
  new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);

/** Decimal units, like Neon's console: 1 GB = 10^9 bytes. */
export const formatBytes = (bytes: number) => {
  if (bytes >= 1_000_000_000) return `${decimal(bytes / 1_000_000_000, 2)} GB`;
  if (bytes >= 1_000_000) return `${decimal(bytes / 1_000_000, 1)} MB`;
  if (bytes >= 1_000) return `${decimal(bytes / 1_000, 0)} kB`;
  return `${decimal(bytes, 0)} B`;
};

export const formatCuHours = (cuHours: number) =>
  `${decimal(cuHours, cuHours < 10 ? 2 : 1)} CU-h`;

export const formatPercent = (ratio: number) =>
  `${decimal(Math.min(ratio, 9.99) * 100, 0)} %`;

const metric = (
  key: UsageMetricKey,
  label: string,
  used: number,
  limit: number,
  format: (value: number) => string,
): UsageMetric => {
  const ratio = limit > 0 ? used / limit : 0;

  return {
    key,
    label,
    used,
    limit,
    ratio,
    level: levelFor(ratio),
    summary: `${format(used)} de ${format(limit)}`,
  };
};

export type UsageReadings = {
  storageBytes: number;
  /** Month to date; null when the Neon API is not configured. */
  computeCuHours: number | null;
  egressBytes: number | null;
  branches: number | null;
};

/** Compares what was measured against the Free limits, worst metric first. */
export const assessUsage = (readings: UsageReadings): UsageMetric[] => {
  const metrics: UsageMetric[] = [
    metric(
      "storage",
      "Almacenamiento",
      readings.storageBytes,
      NEON_FREE_LIMITS.storageBytes,
      formatBytes,
    ),
  ];

  if (readings.computeCuHours !== null) {
    metrics.push(
      metric(
        "compute",
        "Cómputo del mes",
        readings.computeCuHours,
        NEON_FREE_LIMITS.computeCuHours,
        formatCuHours,
      ),
    );
  }

  if (readings.egressBytes !== null) {
    metrics.push(
      metric(
        "egress",
        "Transferencia del mes",
        readings.egressBytes,
        NEON_FREE_LIMITS.egressBytes,
        formatBytes,
      ),
    );
  }

  if (readings.branches !== null) {
    metrics.push(
      metric(
        "branches",
        "Ramas",
        readings.branches,
        NEON_FREE_LIMITS.branches,
        (value) => decimal(value, 0),
      ),
    );
  }

  return metrics;
};

/** What happens on Neon Free when each limit is reached, for the warning. */
export const LIMIT_CONSEQUENCE: Record<UsageMetricKey, string> = {
  storage: "Al pasar el límite, las escrituras que agregan datos fallan.",
  compute:
    "Al agotarse, la base de datos se suspende hasta el siguiente periodo.",
  egress:
    "Al agotarse, la base de datos se suspende hasta el siguiente periodo.",
  branches: "Al llegar al límite no se pueden crear ramas nuevas.",
};
