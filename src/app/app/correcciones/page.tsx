import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { personEditHref } from "@/components/people/person-detail-model";
import { CorrectionDecision } from "@/components/profile-corrections/correction-decision";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { correctableField } from "@/lib/employee/expediente-model";
import { formatDateMx } from "@/lib/format/date";
import { requirePeopleUpdate } from "@/lib/people/auth";
import { personStatusLabels } from "@/lib/people/schema";
import {
  countPendingProfileCorrections,
  listPendingProfileCorrections,
} from "@/lib/profile-corrections";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: pageTitles.correcciones };

type CorreccionesPageProps = {
  searchParams: Promise<{ despues?: string }>;
};

/**
 * HR's inbox of Mi expediente corrections (Workia 2.0 W2-02): pending
 * requests, oldest first, with what the record said (antes) and what the
 * employee proposes. HR fixes the record in the person form and marks the
 * request applied, or rejects it with a reason. people:update.
 */
const CorreccionesPage = async ({ searchParams }: CorreccionesPageProps) => {
  const session = await requirePeopleUpdate();
  const { despues } = await searchParams;
  const [page, total] = await Promise.all([
    listPendingProfileCorrections(session.companyId, { cursor: despues }),
    countPendingProfileCorrections(session.companyId),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={
          total === 0
            ? "Lo que las personas piden corregir de su expediente desde Mi Workia."
            : `${total} ${total === 1 ? "solicitud pendiente" : "solicitudes pendientes"}, la más antigua primero.`
        }
        title={pageTitles.correcciones}
      />

      {page.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Sin correcciones pendientes</EmptyTitle>
            <EmptyDescription>
              {despues
                ? "No hay más solicitudes después de estas."
                : "Cuando alguien pida corregir un dato desde Mi Workia, aparecerá aquí."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="correcciones">
          {page.items.map((item) => {
            const field = correctableField(item.field);

            return (
              <li
                className="bg-card flex flex-col gap-3 rounded-xl border px-5 py-4"
                data-correction-id={item.id}
                key={item.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      className="font-semibold hover:underline"
                      href={`/app/personas/${item.personId}`}
                    >
                      {item.personName}
                    </Link>
                    <p className="text-muted-foreground text-sm">
                      {field?.label ?? item.field} · pedida el{" "}
                      {formatDateMx(item.createdAt)}
                    </p>
                  </div>
                  {item.personStatus === "baja" ? (
                    <Badge tone="neutral">
                      {personStatusLabels[item.personStatus]}
                    </Badge>
                  ) : null}
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="workia-field-label">Antes</dt>
                    <dd
                      className={
                        item.currentValue
                          ? "break-words"
                          : "text-muted-foreground"
                      }
                      data-testid="correction-before"
                    >
                      {item.currentValue ?? "Sin capturar"}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="workia-field-label">Propuesto</dt>
                    <dd
                      className="font-medium break-words"
                      data-testid="correction-after"
                    >
                      {item.proposedValue}
                    </dd>
                  </div>
                  {item.note ? (
                    <div className="min-w-0 sm:col-span-2">
                      <dt className="workia-field-label">Comentario</dt>
                      <dd className="break-words">{item.note}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="flex flex-wrap items-start gap-2">
                  {field?.hr ? (
                    <Button asChild variant="secondary">
                      <Link
                        href={personEditHref(
                          item.personId,
                          field.hr.section,
                          field.hr.field,
                        )}
                      >
                        Editar expediente
                      </Link>
                    </Button>
                  ) : null}
                </div>
                <CorrectionDecision id={item.id} />
              </li>
            );
          })}
        </ul>
      )}

      {page.next ? (
        <Button asChild className="self-center" variant="secondary">
          <Link
            href={`/app/correcciones?despues=${encodeURIComponent(page.next)}`}
          >
            Ver más
          </Link>
        </Button>
      ) : null}
    </div>
  );
};

export default CorreccionesPage;
