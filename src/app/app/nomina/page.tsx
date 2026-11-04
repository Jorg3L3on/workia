import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { ImportReceiptsDialog } from "@/components/payroll/payroll-forms";
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
import { formatDateMx } from "@/lib/format/date";
import { listPayrollPeriods, payrollStorageReady } from "@/lib/payroll";
import {
  createPayrollPeriodAction,
  finishPayrollImportAction,
} from "@/lib/payroll/actions";
import { openedPercent, PAYROLL_COPY } from "@/lib/payroll/schema";
import { requireCompanyPage } from "@/lib/tenant/context";
import { toneFor } from "@/lib/ui/status-tone";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.nomina,
};

/**
 * Nómina receipts (W2-03): the pay periods, how many receipts each matched and
 * what share of the delivered ones the employees opened. Needs
 * payroll_receipts:read; importing needs payroll_receipts:manage.
 */
const NominaPage = async () => {
  const session = await requireCompanyPage();

  if (!session.permissions.has("payroll_receipts:read")) {
    forbidden();
  }

  const canManage = session.permissions.has("payroll_receipts:manage");
  const storageReady = payrollStorageReady();
  const periods = await listPayrollPeriods(session.companyId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={PAYROLL_COPY.description}
        primary={
          canManage ? (
            <ImportReceiptsDialog
              createAction={createPayrollPeriodAction}
              disabled={!storageReady}
              finishAction={finishPayrollImportAction}
            />
          ) : null
        }
        title={PAYROLL_COPY.title}
      />

      {canManage && !storageReady ? (
        <p className="text-muted-foreground text-sm" role="status">
          {PAYROLL_COPY.storageMissing}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Periodos</CardTitle>
          <CardDescription>
            Abiertos se refiere a recibos entregados que la persona descargó al
            menos una vez.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {periods.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Aún no hay periodos. Importa el zip de recibos del proveedor de
              nómina.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Periodo</TableHead>
                  <TableHead>Fechas</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Recibos</TableHead>
                  <TableHead className="text-right">Sin asignar</TableHead>
                  <TableHead className="text-right">Abiertos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {periods.map((period) => (
                  <TableRow key={period.id}>
                    <TableCell className="font-medium">
                      <Link
                        className="hover:underline"
                        href={`/app/nomina/${period.id}`}
                      >
                        {period.label}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {formatDateMx(period.periodStart)} al{" "}
                      {formatDateMx(period.periodEnd)}
                    </TableCell>
                    <TableCell>
                      <Badge tone={toneFor("payrollPeriod", period.status)}>
                        {period.status === "published"
                          ? "Publicado"
                          : "Borrador"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {period.receipts}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {period.receipts - period.matched}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {period.delivered > 0
                        ? `${openedPercent(period.opened, period.delivered)} %`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default NominaPage;
