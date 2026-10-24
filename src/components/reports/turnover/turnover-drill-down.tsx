"use client";

import { ExternalLinkIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateMx } from "@/lib/format/date";
import { terminationTypeLabels } from "@/lib/people/employment-schema";
import type { TurnoverDetailRow } from "@/lib/reports/turnover/report";
import { terminationClassificationLabels } from "@/lib/termination-reasons/schema";

import { plural } from "./format";

/** What was clicked: the rows behind it and the closest Personas link. */
export type DrillSelection = {
  title: string;
  description: string;
  kind: "exits" | "hires";
  rows: TurnoverDetailRow[];
  /** null when Personas has no equivalent filter («Otros», «Sin área»). */
  personasHref: string | null;
};

const yesNo = (value: boolean | null) =>
  value === null ? "—" : value ? "Sí" : "No";

/**
 * The people behind a number (WRK-I12), inside the dashboard. Never payroll
 * data: no finiquito, no salary. The list is the source of truth; Personas
 * filters each person's current period, so people who came back after this
 * baja do not show there.
 */
export const TurnoverDrillDown = ({
  selection,
  onClose,
}: {
  selection: DrillSelection | null;
  onClose: () => void;
}) => {
  const rows = selection?.rows ?? [];
  const rehired = rows.filter((row) => row.hasLaterPeriod).length;
  const exits = selection?.kind === "exits";

  return (
    <Sheet
      onOpenChange={(open) => !open && onClose()}
      open={selection !== null}
    >
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle>{selection?.title}</SheetTitle>
          <SheetDescription>
            {selection?.description} ·{" "}
            {exits
              ? plural(rows.length, "baja", "bajas")
              : plural(rows.length, "ingreso", "ingresos")}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="text-muted-foreground p-4 text-sm">
              No hay personas en esta selección.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>Ingreso</TableHead>
                  <TableHead>Baja</TableHead>
                  <TableHead className="text-right">Días</TableHead>
                  {exits ? (
                    <>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Clasificación</TableHead>
                      <TableHead>Recontratable</TableHead>
                    </>
                  ) : (
                    <TableHead>Reingreso</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-48">
                      <Link
                        className="hover:text-primary block truncate font-medium hover:underline"
                        href={`/app/personas/${row.personId}`}
                      >
                        {row.personName}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDateMx(row.fechaIngreso)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatDateMx(row.fechaBaja)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.days ?? "—"}
                    </TableCell>
                    {exits ? (
                      <>
                        <TableCell>
                          {row.tipoBaja
                            ? terminationTypeLabels[row.tipoBaja]
                            : "—"}
                        </TableCell>
                        <TableCell className="max-w-40 truncate">
                          {row.motivo ?? "Sin motivo"}
                        </TableCell>
                        <TableCell>
                          {row.classification
                            ? terminationClassificationLabels[
                                row.classification
                              ]
                            : "—"}
                        </TableCell>
                        <TableCell>{yesNo(row.recontratable)}</TableCell>
                      </>
                    ) : (
                      <TableCell>{row.firstOfPerson ? "No" : "Sí"}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        {selection?.personasHref ? (
          <SheetFooter className="border-t">
            {exits && rehired > 0 ? (
              <p className="text-muted-foreground text-xs">
                Personas mostrará {rows.length - rehired} de {rows.length}:{" "}
                {plural(rehired, "persona reingresó", "personas reingresaron")}{" "}
                después y allá se ve su periodo actual. Quien cambió de área
                después tampoco aparece con ese filtro.
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Personas filtra por la baja y el área actuales de cada persona.
              </p>
            )}
            <Button asChild variant="secondary">
              <Link href={selection.personasHref}>
                <ExternalLinkIcon aria-hidden />
                Abrir en Personas
              </Link>
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};
