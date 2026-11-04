/**
 * Month-to-date usage from the Neon API (Free plan endpoints). Optional: it
 * needs NEON_API_KEY and NEON_PROJECT_ID, which Jorge adds if he wants
 * compute and egress shown. Without them only the database size is read.
 *
 * These endpoints do not wake a suspended compute, so reading them costs no
 * CU-hours. Their numbers are Neon's monitoring figures, not billing.
 */

const NEON_API = "https://console.neon.tech/api/v2";
const TIMEOUT_MS = 5_000;

export type NeonProjectUsage = {
  computeCuHours: number;
  activeHours: number;
  egressBytes: number;
  /** Logical size summed over every branch: what the Free storage cap counts. */
  storageBytes: number;
  branches: number;
  periodStart: Date | null;
};

type FetchLike = typeof fetch;

const toNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value) || 0
      : 0;

export const parseNeonUsage = (
  projectBody: unknown,
  branchesBody: unknown,
): NeonProjectUsage => {
  const project = ((projectBody as { project?: Record<string, unknown> } | null)
    ?.project ?? {}) as Record<string, unknown>;
  const branchList = (branchesBody as { branches?: unknown } | null)?.branches;
  const branches = Array.isArray(branchList)
    ? (branchList as Array<Record<string, unknown>>)
    : [];
  const periodStart =
    typeof project.consumption_period_start === "string"
      ? new Date(project.consumption_period_start)
      : null;

  return {
    computeCuHours: toNumber(project.compute_time_seconds) / 3600,
    activeHours: toNumber(project.active_time_seconds) / 3600,
    egressBytes: toNumber(project.data_transfer_bytes),
    storageBytes: branches.reduce(
      (total, branch) => total + toNumber(branch.logical_size),
      0,
    ),
    branches: branches.length,
    periodStart:
      periodStart && !Number.isNaN(periodStart.getTime()) ? periodStart : null,
  };
};

export type NeonApiConfig = { apiKey: string; projectId: string };

export const readNeonApiConfig = (
  source: Record<string, string | undefined>,
): NeonApiConfig | null => {
  const apiKey = source.NEON_API_KEY?.trim();
  const projectId = source.NEON_PROJECT_ID?.trim();

  return apiKey && projectId ? { apiKey, projectId } : null;
};

export const fetchNeonUsage = async (
  config: NeonApiConfig,
  fetchImpl: FetchLike = fetch,
): Promise<NeonProjectUsage> => {
  const get = async (path: string) => {
    const response = await fetchImpl(`${NEON_API}${path}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Neon API ${path.split("/").pop()}: ${response.status}`);
    }

    return response.json() as Promise<unknown>;
  };

  const id = encodeURIComponent(config.projectId);
  const [project, branches] = await Promise.all([
    get(`/projects/${id}`),
    get(`/projects/${id}/branches`),
  ]);

  return parseNeonUsage(project, branches);
};
