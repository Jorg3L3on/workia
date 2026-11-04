import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DatabaseUsage } from "@/lib/db-usage";
import { assessUsage, worstLevel } from "@/lib/db-usage/limits";

import { UsageNotice } from "./usage-notice";

const usageFor = (storageBytes: number, computeCuHours: number | null) => {
  const metrics = assessUsage({
    storageBytes,
    computeCuHours,
    egressBytes: null,
    branches: null,
  });

  return {
    metrics,
    level: worstLevel(metrics.map((metric) => metric.level)),
    source: computeCuHours === null ? "postgres" : "neon",
    neonNote: null,
    periodStart: null,
    measuredAt: new Date("2026-11-04T12:00:00Z"),
  } satisfies DatabaseUsage;
};

describe("UsageNotice", () => {
  it("shows nothing while every limit is under 80 %", () => {
    const { container } = render(
      <UsageNotice usage={usageFor(500_000_000, 40)} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("warns about the limit that is near, with what happens next", () => {
    render(<UsageNotice usage={usageFor(500_000_000, 85)} />);

    expect(
      screen.getByText(
        "La base de datos se acerca al límite del plan gratuito",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cómputo del mes: 85 %/)).toBeInTheDocument();
    expect(screen.queryByText(/Almacenamiento/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("turns urgent at 95 % and links platform admins to the details", () => {
    render(
      <UsageNotice
        detailsHref="/admin/uso"
        usage={usageFor(970_000_000, null)}
      />,
    );

    expect(
      screen.getByText("La base de datos llegó al límite del plan gratuito"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/las escrituras que agregan datos fallan/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/admin/uso");
  });
});
