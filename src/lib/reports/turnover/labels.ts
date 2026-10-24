/** Names of the report's groups and the reporting tree (WRK-I12). */
export type TurnoverLabels = {
  areas: Record<string, string>;
  sites: Record<string, string>;
  positions: Record<string, string>;
  managers: Record<string, string>;
  /** Jefe → their direct reports, for «todo el equipo». */
  reportsOf: Record<string, string[]>;
};

/** Ids of the people under `managerId`, at any depth. */
export const teamOf = (
  managerId: string,
  reportsOf: Record<string, string[]>,
) => {
  const team = new Set<string>();
  const queue = [...(reportsOf[managerId] ?? [])];

  while (queue.length > 0) {
    const id = queue.shift()!;

    if (team.has(id) || id === managerId) continue;

    team.add(id);
    queue.push(...(reportsOf[id] ?? []));
  }

  return team;
};
