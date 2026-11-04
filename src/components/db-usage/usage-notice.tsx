import Link from "next/link";
import { DatabaseIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  formatPercent,
  LIMIT_CONSEQUENCE,
  type UsageMetric,
} from "@/lib/db-usage/limits";
import type { DatabaseUsage } from "@/lib/db-usage";

type UsageNoticeProps = {
  usage: DatabaseUsage;
  /** Platform admins get a link to /admin/uso. */
  detailsHref?: string;
};

const sentence = (metric: UsageMetric) =>
  `${metric.label}: ${formatPercent(metric.ratio)} (${metric.summary}). ${LIMIT_CONSEQUENCE[metric.key]}`;

/**
 * Warning before a Neon Free limit is reached. Renders nothing while every
 * limit is under WARN_RATIO.
 */
export const UsageNotice = ({ usage, detailsHref }: UsageNoticeProps) => {
  const nearing = usage.metrics.filter((metric) => metric.level !== "ok");

  if (nearing.length === 0) return null;

  const critical = usage.level === "critical";

  return (
    <Alert variant={critical ? "destructive" : "default"}>
      <DatabaseIcon aria-hidden />
      <AlertTitle>
        {critical
          ? "La base de datos llegó al límite del plan gratuito"
          : "La base de datos se acerca al límite del plan gratuito"}
      </AlertTitle>
      <AlertDescription>
        {nearing.map((metric) => (
          <p key={metric.key}>{sentence(metric)}</p>
        ))}
        {detailsHref ? (
          <p>
            <Link href={detailsHref}>Ver el uso de la base de datos</Link>
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
};
