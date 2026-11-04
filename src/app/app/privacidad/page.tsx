import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import {
  CreateArcoRequestForm,
  PublishNoticeForm,
  RecordAcceptanceForm,
  ResolveArcoRequestButton,
} from "@/components/privacy/privacy-forms";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { formatDateMx, formatDateTimeMx, isoToday } from "@/lib/format/date";
import {
  listArcoRequests,
  listPersonalDataAccess,
  listPrivacyNotices,
} from "@/lib/privacy";
import {
  createArcoRequestAction,
  publishPrivacyNoticeAction,
  recordPrivacyAcceptanceAction,
  resolveArcoRequestAction,
} from "@/lib/privacy/actions";
import { RETENTION_POLICY } from "@/lib/privacy/retention";
import {
  ARCO_RESPONSE_DAYS,
  arcoDaysLeft,
  arcoKindLabels,
  arcoStatusLabels,
  PRIVACY_COPY,
  personalDataResourceLabels,
} from "@/lib/privacy/schema";
import { requireCompanyPage } from "@/lib/tenant/context";
import { toneFor } from "@/lib/ui/status-tone";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.privacidad,
};

const TABS = ["aviso", "arco", "conservacion", "accesos"] as const;

type PrivacidadPageProps = {
  searchParams: Promise<{ vista?: string }>;
};

const dueLabel = (daysLeft: number) => {
  if (daysLeft < 0) {
    return `Vencida hace ${-daysLeft} ${-daysLeft === 1 ? "día" : "días"}`;
  }

  if (daysLeft === 0) {
    return "Vence hoy";
  }

  return `Faltan ${daysLeft} ${daysLeft === 1 ? "día" : "días"}`;
};

/**
 * Privacy (W2-09): the notice and its versions, ARCO requests, the retention
 * policy and the personal data access log. Needs privacy:read; writing and
 * the ARCO export need privacy:manage.
 */
const PrivacidadPage = async ({ searchParams }: PrivacidadPageProps) => {
  const session = await requireCompanyPage();

  if (!session.permissions.has("privacy:read")) {
    forbidden();
  }

  const canManage = session.permissions.has("privacy:manage");
  const { vista } = await searchParams;
  const tab = TABS.find((value) => value === vista) ?? "aviso";
  const today = isoToday();
  const [notices, requests, accesses] = await Promise.all([
    listPrivacyNotices(session.companyId),
    listArcoRequests(session.companyId),
    listPersonalDataAccess(session.companyId),
  ]);
  const current = notices[0] ?? null;
  const openRequests = requests.filter((row) => row.status === "received");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={PRIVACY_COPY.description}
        title={PRIVACY_COPY.title}
      />

      <Tabs className="gap-4" defaultValue={tab}>
        <TabsList
          className="h-9 w-full justify-start overflow-x-auto bg-transparent p-0"
          variant="line"
        >
          <TabsTrigger className="flex-none px-3" value="aviso">
            Aviso
          </TabsTrigger>
          <TabsTrigger className="flex-none px-3" value="arco">
            Solicitudes ARCO
            {openRequests.length > 0 ? ` (${openRequests.length})` : ""}
          </TabsTrigger>
          <TabsTrigger className="flex-none px-3" value="conservacion">
            Conservación
          </TabsTrigger>
          <TabsTrigger className="flex-none px-3" value="accesos">
            Accesos
          </TabsTrigger>
        </TabsList>

        <TabsContent className="flex flex-col gap-4" value="aviso">
          <Card>
            <CardHeader>
              <CardTitle>
                {current
                  ? `${PRIVACY_COPY.noticeTitle} · versión ${current.version}`
                  : PRIVACY_COPY.noticeTitle}
              </CardTitle>
              <CardDescription>
                {current
                  ? `Publicada el ${formatDateTimeMx(current.publishedAt)}${current.publishedByName ? ` por ${current.publishedByName}` : ""}. ${current.acceptances} ${current.acceptances === 1 ? "aceptación" : "aceptaciones"}.`
                  : PRIVACY_COPY.noticeEmpty}
              </CardDescription>
            </CardHeader>
            {current ? (
              <CardContent>
                <div className="bg-muted/40 max-h-80 overflow-auto rounded-lg p-3 text-sm whitespace-pre-wrap">
                  {current.body}
                </div>
              </CardContent>
            ) : null}
          </Card>

          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {current ? "Publicar una versión nueva" : "Publicar el aviso"}
                </CardTitle>
                <CardDescription>
                  El texto debe pasar por la revisión legal contra la LFPDPPP
                  vigente antes de publicarse.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PublishNoticeForm
                  action={publishPrivacyNoticeAction}
                  currentBody={current?.body ?? null}
                />
              </CardContent>
            </Card>
          ) : null}

          {canManage && current ? (
            <Card>
              <CardHeader>
                <CardTitle>Aceptación en papel</CardTitle>
                <CardDescription>
                  Para quien firmó el aviso impreso. En la app, la persona lo
                  acepta al entrar por primera vez.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RecordAcceptanceForm
                  action={recordPrivacyAcceptanceAction}
                  noticeId={current.id}
                  version={current.version}
                />
              </CardContent>
            </Card>
          ) : null}

          {notices.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>Versiones</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Versión</TableHead>
                      <TableHead>Publicada</TableHead>
                      <TableHead>Por</TableHead>
                      <TableHead className="text-right">Aceptaciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notices.map((notice) => (
                      <TableRow key={notice.id}>
                        <TableCell>{notice.version}</TableCell>
                        <TableCell>
                          {formatDateTimeMx(notice.publishedAt)}
                        </TableCell>
                        <TableCell>{notice.publishedByName ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {notice.acceptances}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent className="flex flex-col gap-4" value="arco">
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Registrar solicitud</CardTitle>
                <CardDescription>
                  Acceso, rectificación, cancelación u oposición. La respuesta
                  vence {ARCO_RESPONSE_DAYS} días naturales después de
                  recibirla.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CreateArcoRequestForm
                  action={createArcoRequestAction}
                  today={today}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{PRIVACY_COPY.arcoTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              {requests.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {PRIVACY_COPY.arcoEmpty}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Persona</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Recibida</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Detalle</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((request) => {
                      const open = request.status === "received";
                      const daysLeft = arcoDaysLeft(request.dueOn, today);
                      const tone = toneFor(
                        "arco",
                        open && daysLeft < 0 ? "late" : request.status,
                      );

                      return (
                        <TableRow key={request.id}>
                          <TableCell className="font-medium">
                            {request.personName}
                          </TableCell>
                          <TableCell>{arcoKindLabels[request.kind]}</TableCell>
                          <TableCell>
                            {formatDateMx(request.receivedOn)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge tone={tone}>
                                {arcoStatusLabels[request.status]}
                              </Badge>
                              <span className="text-muted-foreground text-xs">
                                {open
                                  ? `${dueLabel(daysLeft)} · ${formatDateMx(request.dueOn)}`
                                  : request.resolvedAt
                                    ? `Cerrada el ${formatDateTimeMx(request.resolvedAt)}`
                                    : null}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="max-w-80 text-sm whitespace-pre-wrap">
                            {request.detail}
                            {request.response ? (
                              <span className="text-muted-foreground mt-1 block">
                                Respuesta: {request.response}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {canManage && request.kind === "access" ? (
                                <Button asChild size="sm" variant="ghost">
                                  <a
                                    download
                                    href={`/app/privacidad/arco/${request.id}/exportar`}
                                  >
                                    Exportar datos
                                  </a>
                                </Button>
                              ) : null}
                              {canManage && open ? (
                                <ResolveArcoRequestButton
                                  action={resolveArcoRequestAction}
                                  personName={request.personName}
                                  requestId={request.id}
                                />
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conservacion">
          <Card>
            <CardHeader>
              <CardTitle>{PRIVACY_COPY.retentionTitle}</CardTitle>
              <CardDescription>
                Lo marcado como automático se borra por lotes con la tarea de
                conservación. Los plazos están pendientes de revisión legal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Registro</TableHead>
                    <TableHead>Se conserva</TableHead>
                    <TableHead>Fundamento</TableHead>
                    <TableHead>Borrado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {RETENTION_POLICY.map((rule) => (
                    <TableRow key={rule.key}>
                      <TableCell className="font-medium">
                        {rule.label}
                      </TableCell>
                      <TableCell>{rule.period}</TableCell>
                      <TableCell>{rule.basis}</TableCell>
                      <TableCell>
                        {rule.automaticMonths === null
                          ? "Manual"
                          : "Automático"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accesos">
          <Card>
            <CardHeader>
              <CardTitle>{PRIVACY_COPY.accessTitle}</CardTitle>
              <CardDescription>
                Las últimas 100 aperturas de contratos, constancias, recibos,
                documentos y exportaciones ARCO.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {accesses.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {PRIVACY_COPY.accessEmpty}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cuándo</TableHead>
                      <TableHead>Persona</TableHead>
                      <TableHead>Qué</TableHead>
                      <TableHead>Quién</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accesses.map((access) => (
                      <TableRow key={access.id}>
                        <TableCell>
                          {formatDateTimeMx(access.accessedAt)}
                        </TableCell>
                        <TableCell>{access.personName}</TableCell>
                        <TableCell>
                          {personalDataResourceLabels[access.resource]}
                        </TableCell>
                        <TableCell>
                          {access.actorKind === "employee"
                            ? "La persona"
                            : (access.actorName ?? "—")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PrivacidadPage;
