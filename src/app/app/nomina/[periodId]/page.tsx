import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";

import { PageHeader } from "@/components/layout/page-header";
import {
  AssignReceiptForm,
  DiscardPeriodButton,
  ImportReceiptsDialog,
  PublishPeriodButton,
} from "@/components/payroll/payroll-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatDateMx, formatDateTimeMx } from "@/lib/format/date";
import {
  getPayrollPeriod,
  listPayrollReceipts,
  payrollStorageReady,
} from "@/lib/payroll";
import {
  assignPayrollReceiptAction,
  createPayrollPeriodAction,
  discardPayrollPeriodAction,
  finishPayrollImportAction,
  publishPayrollPeriodAction,
} from "@/lib/payroll/actions";
import { matchKindLabels, openedPercent } from "@/lib/payroll/schema";
import { requireCompanyPage } from "@/lib/tenant/context";
import { toneFor } from "@/lib/ui/status-tone";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Periodo de nómina",
};

type PeriodPageProps = {
  params: Promise<{ periodId: string }>;
};

/**
 * One pay period (W2-03): the receipts that did not match, to assign by
 * hand, and every receipt with who it went to and whether it was opened.
 */
const PeriodPage = async ({ params }: PeriodPageProps) => {
  const session = await requireCompanyPage();

  if (!session.permissions.has("payroll_receipts:read")) {
    forbidden();
  }

  const { periodId } = await params;

  if (!z.string().uuid().safeParse(periodId).success) {
    notFound();
  }

  const [period, receipts] = await Promise.all([
    getPayrollPeriod(session.companyId, periodId),
    listPayrollReceipts(session.companyId, periodId),
  ]);

  if (!period) {
    notFound();
  }

  const canManage = session.permissions.has("payroll_receipts:manage");
  const draft = period.status === "draft";
  const unmatched = receipts.filter((receipt) => !receipt.personId);
  const matched = receipts.filter((receipt) => receipt.personId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={`Del ${formatDateMx(period.periodStart)} al ${formatDateMx(period.periodEnd)}.`}
        primary={
          canManage && draft ? (
            <PublishPeriodButton
              action={publishPayrollPeriodAction}
              matched={period.matched}
              periodId={period.id}
              unmatched={period.receipts - period.matched}
            />
          ) : null
        }
        secondary={
          canManage ? (
            <ImportReceiptsDialog
              createAction={createPayrollPeriodAction}
              disabled={!payrollStorageReady()}
              finishAction={finishPayrollImportAction}
              periodId={period.id}
              triggerLabel="Agregar recibos"
            />
          ) : null
        }
        status={
          <Badge tone={toneFor("payrollPeriod", period.status)}>
            {draft
              ? "Borrador"
              : `Publicado ${period.publishedAt ? formatDateTimeMx(period.publishedAt) : ""}`}
          </Badge>
        }
        title={period.label}
        variant="detail"
      />

      <dl className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Recibos", value: period.receipts },
          { label: "Sin asignar", value: period.receipts - period.matched },
          { label: "Entregados", value: period.delivered },
          {
            label: "Abiertos",
            value:
              period.delivered > 0
                ? `${openedPercent(period.opened, period.delivered)} % (${period.opened})`
                : "—",
          },
        ].map((fact) => (
          <div className="workia-pass-card px-4 py-3" key={fact.label}>
            <dt className="workia-field-label">{fact.label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {unmatched.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sin asignar</CardTitle>
            <CardDescription>
              Ningún expediente tiene el CURP, el número de empleado o el RFC de
              estos CFDI. Asígnalos a mano; el número de empleado se recuerda
              para el siguiente periodo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receptor en el CFDI</TableHead>
                  <TableHead>CURP</TableHead>
                  <TableHead>Núm. empleado</TableHead>
                  <TableHead>RFC</TableHead>
                  {canManage ? <TableHead>Asignar a</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {unmatched.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell className="font-medium">
                      {receipt.receptorName ?? "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {receipt.receptorCurp ?? "—"}
                    </TableCell>
                    <TableCell>{receipt.receptorNumEmpleado ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {receipt.receptorRfc}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="min-w-64">
                        <AssignReceiptForm
                          action={assignPayrollReceiptAction}
                          periodId={period.id}
                          receiptId={receipt.id}
                        />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recibos asignados</CardTitle>
          <CardDescription>
            {draft
              ? "Se entregan al publicar el periodo."
              : "Entregados en la app de cada persona."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {matched.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Ningún recibo asignado todavía.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>Asignado por</TableHead>
                  <TableHead>Abierto</TableHead>
                  <TableHead className="text-right">Archivos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matched.map((receipt) => (
                  <TableRow key={receipt.id}>
                    <TableCell className="font-medium">
                      {receipt.personName ?? receipt.receptorName}
                    </TableCell>
                    <TableCell>
                      {receipt.matchKind
                        ? matchKindLabels[receipt.matchKind]
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {receipt.openedAt
                        ? formatDateTimeMx(receipt.openedAt)
                        : receipt.deliveredAt
                          ? "No"
                          : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {receipt.hasPdf ? (
                          <Button asChild size="sm" variant="ghost">
                            <a
                              href={`/app/nomina/recibos/${receipt.id}/pdf`}
                              rel="noopener"
                              target="_blank"
                            >
                              PDF
                            </a>
                          </Button>
                        ) : null}
                        <Button asChild size="sm" variant="ghost">
                          <a href={`/app/nomina/recibos/${receipt.id}/xml`}>
                            XML
                          </a>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManage && draft ? (
        <div>
          <DiscardPeriodButton
            action={discardPayrollPeriodAction}
            periodId={period.id}
          />
        </div>
      ) : null}
    </div>
  );
};

export default PeriodPage;
