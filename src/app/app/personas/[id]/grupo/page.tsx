import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import { OpenInCompanyButton } from "@/components/transfers/open-in-company-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateMx, formatDateTimeMx } from "@/lib/format/date";
import { requirePeopleRead } from "@/lib/people/auth";
import { formatPersonName, personStatusLabels } from "@/lib/people/schema";
import { toneFor } from "@/lib/ui/status-tone";
import {
  decodeTimelineCursor,
  encodeTimelineCursor,
} from "@/lib/transfers/cursor";
import { describeGroupEvent } from "@/lib/transfers/describe";
import { listGroupTimeline, loadGroupReader } from "@/lib/transfers/group";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Historial del grupo",
};

type GrupoPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ antes?: string }>;
};

const PAGE_SIZE = 50;

/**
 * The group timeline of a person (W2-24): their rows in every company of the
 * group linked by transfers, and the events of all of them, newest first.
 * Each company is read under its own row-level security; a company the
 * viewer may not read shows only its name.
 */
const GrupoPage = async ({ params, searchParams }: GrupoPageProps) => {
  const session = await requirePeopleRead();
  const { id } = await params;
  const { antes } = await searchParams;
  const reader = await loadGroupReader(session.user.id);
  const page = await listGroupTimeline(reader, session.companyId, id, {
    before: decodeTimelineCursor(antes),
    limit: PAGE_SIZE,
  });
  const start = page?.rows[0];

  if (!page || !start?.person) {
    notFound();
  }

  const personName = formatPersonName(start.person);
  const names = new Map(
    page.rows.map((row) => [row.companyId, row.companyName]),
  );
  const memberOf = new Set(session.memberships.map((item) => item.companyId));
  const hidden = page.rows.filter((row) => !row.visible).length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <PageBreadcrumbLabel label={personName} />
      <PageHeader
        description="Sus expedientes en las empresas del grupo, unidos por traslados, y todo lo que les pasó en un solo historial."
        title={`Historial del grupo · ${personName}`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Expedientes en el grupo</CardTitle>
          {hidden > 0 ? (
            <CardDescription>
              {hidden === 1
                ? "Un expediente está en una empresa que no puedes consultar."
                : `${hidden} expedientes están en empresas que no puedes consultar.`}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <ul className="divide-border divide-y">
            {page.rows.map((row) => (
              <li
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                key={row.personId}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{row.companyName}</p>
                  {row.person ? (
                    <p className="text-muted-foreground text-xs">
                      {formatPersonName(row.person)}
                      {row.person.fechaIngreso
                        ? ` · ingreso ${formatDateMx(row.person.fechaIngreso)}`
                        : ""}
                    </p>
                  ) : (
                    <p className="text-muted-foreground text-xs">Sin acceso</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {row.person ? (
                    <Badge tone={toneFor("person", row.person.status)}>
                      {personStatusLabels[row.person.status]}
                    </Badge>
                  ) : null}
                  {row.companyId === session.companyId ? (
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/app/personas/${row.personId}`}>
                        Ver expediente
                      </Link>
                    </Button>
                  ) : row.visible && memberOf.has(row.companyId) ? (
                    <OpenInCompanyButton
                      companyId={row.companyId}
                      companyName={row.companyName}
                      href={`/app/personas/${row.personId}`}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {page.events.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Todavía no hay eventos en su historial.
            </p>
          ) : (
            <ol className="divide-border divide-y" data-testid="group-timeline">
              {page.events.map((event) => (
                <li
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                  key={event.id}
                >
                  <span className="text-sm">
                    {describeGroupEvent(event, names)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {event.companyName} ·{" "}
                    {event.type === "employment" ||
                    event.type === "vacation" ||
                    event.type === "document"
                      ? formatDateMx(event.occurredAt)
                      : formatDateTimeMx(event.occurredAt)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {page.next ? (
            <Button asChild variant="secondary">
              <Link
                href={`/app/personas/${id}/grupo?antes=${encodeURIComponent(encodeTimelineCursor(page.next))}`}
              >
                Ver anteriores
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export default GrupoPage;
