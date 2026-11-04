import type { Metadata } from "next";

import {
  UsageMeter,
  usageLevelLabel,
  usageTone,
} from "@/components/db-usage/usage-meter";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { pageTitles } from "@/lib/brand/chrome-copy";
import {
  formatBytes,
  getDatabaseUsage,
  NEON_FREE_LIMITS,
  readLargestTables,
  readSlowQueries,
} from "@/lib/db-usage";
import { requirePlatformAdmin } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.usoBaseDatos,
};

const dateTime = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Mexico_City",
});

const integer = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
const ms = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

/** Neon Free usage (Workia 2.0, P-03): limits, largest tables, slow queries. */
export default async function AdminUsagePage() {
  await requirePlatformAdmin();

  const [usage, tables, slow] = await Promise.all([
    getDatabaseUsage(),
    readLargestTables(10),
    readSlowQueries({ limit: 10 }),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {pageTitles.usoBaseDatos}
          </h1>
          <Badge tone={usageTone[usage.level]}>
            {usageLevelLabel[usage.level]}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Lo usado contra los límites del plan gratuito de Neon (medido el{" "}
          {dateTime.format(usage.measuredAt)}
          {usage.periodStart
            ? `; el periodo empezó el ${dateTime.format(usage.periodStart)}`
            : ""}
          ).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Límites del plan gratuito</CardTitle>
          <CardDescription>
            Aviso desde el 80 %. Historial de restauración:{" "}
            {NEON_FREE_LIMITS.restoreHistoryHours} horas.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2">
          {usage.metrics.map((metric) => (
            <UsageMeter key={metric.key} metric={metric} />
          ))}
        </CardContent>
        {usage.neonNote ? (
          <CardContent>
            <p className="text-muted-foreground text-sm">{usage.neonNote}</p>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tablas más grandes</CardTitle>
          <CardDescription>
            Con índices. Las filas son la estimación del último ANALYZE (— si
            aún no hay).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tabla</TableHead>
                <TableHead className="text-right">Tamaño</TableHead>
                <TableHead className="text-right">Filas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tables.map((table) => (
                <TableRow key={table.name}>
                  <TableCell className="font-mono text-xs">
                    {table.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBytes(table.totalBytes)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {table.approxRows === null
                      ? "—"
                      : integer.format(table.approxRows)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consultas más lentas</CardTitle>
          <CardDescription>
            {slow.available
              ? `Por tiempo total (desde ${slow.since ? dateTime.format(slow.since) : "el último reinicio"}). Neon borra estas estadísticas cuando la base de datos se suspende.`
              : slow.reason}
          </CardDescription>
        </CardHeader>
        {slow.available ? (
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Consulta</TableHead>
                  <TableHead className="text-right">Llamadas</TableHead>
                  <TableHead className="text-right">Promedio</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {slow.queries.map((query, index) => (
                  <TableRow key={index}>
                    <TableCell className="max-w-md truncate font-mono text-xs">
                      <span title={query.query}>{query.query}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {integer.format(query.calls)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ms.format(query.meanMs)} ms
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ms.format(query.totalMs)} ms
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
