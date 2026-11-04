import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { TransferForm } from "@/components/transfers/transfer-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listActiveAreas, listActivePositions } from "@/lib/catalog";
import { formatDateMx, isoToday } from "@/lib/format/date";
import { getPersonById } from "@/lib/people";
import { getEmploymentSummary } from "@/lib/people/employment";
import { formatPersonName } from "@/lib/people/schema";
import { listActiveSites } from "@/lib/sites";
import { requireCompanyContext } from "@/lib/tenant/context";
import { listTransferTargets } from "@/lib/transfers/access";
import { transferPersonAction } from "@/lib/transfers/actions";
import { TRANSFER_COPY } from "@/lib/transfers/rules";
import { AuthorizationError } from "@/lib/rbac/errors";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: TRANSFER_COPY.title,
};

type TrasladoPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ empresa?: string }>;
};

/**
 * Transfer to another company of the group (W2-24): pick the company, then
 * the first day there and its área, puesto and sucursal. Only companies where
 * the actor also has people:transfer are offered.
 */
const TrasladoPage = async ({ params, searchParams }: TrasladoPageProps) => {
  const session = await requireCompanyContext("people:transfer").catch(
    (error: unknown) => {
      if (error instanceof AuthorizationError) notFound();
      throw error;
    },
  );
  const { id } = await params;
  const { empresa } = await searchParams;
  const [person, summary, targets] = await Promise.all([
    getPersonById(session.companyId, id),
    getEmploymentSummary(session.companyId, id),
    listTransferTargets(session),
  ]);

  if (!person) {
    notFound();
  }

  const personName = formatPersonName(person);
  const target = targets.find((item) => item.companyId === empresa);
  const [areas, positions, sites] = target
    ? await Promise.all([
        listActiveAreas(target.companyId),
        listActivePositions(target.companyId),
        listActiveSites(target.companyId),
      ])
    : [[], [], []];
  const fromName = session.membership.companyName;
  const blocked =
    person.status !== "activa"
      ? TRANSFER_COPY.notActive
      : targets.length === 0
        ? "No tienes acceso para trasladar a ninguna otra empresa del grupo. Pide a quien administra la plataforma que te dé un rol con permiso de traslado en la empresa de destino."
        : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageBreadcrumbLabel label={personName} />
      <PageHeader
        description={`${personName} deja ${fromName} y entra a otra empresa del grupo sin volver a capturar su expediente. Conserva su antigüedad.`}
        title={TRANSFER_COPY.title}
      />

      {blocked ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm">{blocked}</p>
            <Button asChild variant="secondary">
              <Link href={`/app/personas/${person.id}`}>
                Volver al expediente
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Empresa de destino</CardTitle>
              <CardDescription>
                Solo aparecen las empresas donde también puedes trasladar.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {targets.map((item) => (
                <Button
                  asChild
                  key={item.companyId}
                  variant={
                    item.companyId === target?.companyId
                      ? "primary"
                      : "secondary"
                  }
                >
                  <Link
                    aria-current={
                      item.companyId === target?.companyId ? "true" : undefined
                    }
                    href={`/app/personas/${person.id}/traslado?empresa=${item.companyId}`}
                  >
                    {item.companyName}
                  </Link>
                </Button>
              ))}
            </CardContent>
          </Card>

          {target ? (
            <Card>
              <CardHeader>
                <CardTitle>Traslado a {target.companyName}</CardTitle>
                <CardDescription>
                  Su periodo en {fromName} se cierra el día anterior como
                  «traslado» y su contrato vigente queda terminado. En{" "}
                  {target.companyName} se abre un periodo nuevo
                  {summary?.fechaAntiguedad
                    ? ` que reconoce su antigüedad desde el ${formatDateMx(summary.fechaAntiguedad)}`
                    : " que reconoce su antigüedad"}
                  . Si {target.companyName} ya tiene su expediente (misma CURP),
                  se reabre; si no, se crea con sus datos personales y
                  beneficiarios. Su cuenta de la app de empleados se vuelve a
                  invitar en la empresa nueva.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TransferForm
                  action={transferPersonAction.bind(null, person.id)}
                  areas={areas.map((row) => ({ id: row.id, name: row.name }))}
                  defaultDate={isoToday()}
                  positions={positions.map((row) => ({
                    id: row.id,
                    name: row.name,
                  }))}
                  sites={sites.map((row) => ({ id: row.id, name: row.name }))}
                  toCompanyId={target.companyId}
                  toCompanyName={target.companyName}
                />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
};

export default TrasladoPage;
