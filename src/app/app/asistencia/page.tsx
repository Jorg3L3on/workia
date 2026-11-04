import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";

import {
  ActionButton,
  AssignBadgeForm,
  CheckinSiteForm,
  DeviceForm,
  DeviceTokenForm,
  UploadChecadasForm,
} from "@/components/attendance/attendance-forms";
import { PageHeader } from "@/components/layout/page-header";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ATTENDANCE_COPY,
  countOpenUnmatched,
  listAttendanceBatches,
  listAttendanceDevices,
  listBadges,
  listCheckinSites,
  listOpenUnmatched,
} from "@/lib/attendance";
import {
  assignBadgeAction,
  dismissUnmatchedAction,
  importChecadorCsvAction,
  issueDeviceTokenAction,
  removeBadgeAction,
  rotateCheckinSecretAction,
  saveAttendanceDeviceAction,
  saveCheckinSiteAction,
  setAttendanceDeviceActiveAction,
} from "@/lib/attendance/actions";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { formatDateMx, formatDateTimeMx } from "@/lib/format/date";
import { formatPersonName } from "@/lib/people/schema";
import { requireCompanyPage } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.asistencia,
};

const TABS = ["cargar", "revisar", "checadores", "numeros", "app"] as const;

type AsistenciaPageProps = {
  searchParams: Promise<{ vista?: string; desde?: string }>;
};

const kindLabel = (kind: string | null) =>
  kind === "in" ? "Entrada" : kind === "out" ? "Salida" : "—";

/**
 * Attendance ingestion (W2-12): uploads of checador exports, the punches no
 * one could be matched to, the checadores and their push tokens, people's
 * checador numbers, and app check-in per site. Needs attendance:read; every
 * change needs attendance:manage.
 */
const AsistenciaPage = async ({ searchParams }: AsistenciaPageProps) => {
  const session = await requireCompanyPage();

  if (!session.permissions.has("attendance:read")) {
    forbidden();
  }

  const canManage = session.permissions.has("attendance:manage");
  const { vista, desde } = await searchParams;
  const tab = TABS.find((value) => value === vista) ?? "cargar";
  const cursor = desde?.slice(0, 2048) ?? null;
  const [devices, batches, unmatched, openCount, badges, checkinSites] =
    await Promise.all([
      listAttendanceDevices(session.companyId),
      listAttendanceBatches(session.companyId, {
        cursor: tab === "cargar" ? cursor : null,
      }),
      listOpenUnmatched(session.companyId, {
        cursor: tab === "revisar" ? cursor : null,
      }),
      countOpenUnmatched(session.companyId),
      listBadges(session.companyId, {
        cursor: tab === "numeros" ? cursor : null,
      }),
      listCheckinSites(session.companyId),
    ]);
  const activeDevices = devices.filter((device) => device.active);
  const sites = checkinSites.map((site) => ({
    id: site.siteId,
    name: site.siteName,
  }));
  const nextLink = (next: string | null) =>
    next ? (
      <Link
        className="text-sm underline-offset-4 hover:underline"
        href={`/app/asistencia?vista=${tab}&desde=${encodeURIComponent(next)}`}
      >
        Ver más
      </Link>
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={ATTENDANCE_COPY.description}
        title={ATTENDANCE_COPY.title}
      />

      <Tabs className="gap-4" defaultValue={tab}>
        <TabsList
          className="h-9 w-full justify-start overflow-x-auto bg-transparent p-0"
          variant="line"
        >
          <TabsTrigger className="flex-none px-3" value="cargar">
            Cargas
          </TabsTrigger>
          <TabsTrigger className="flex-none px-3" value="revisar">
            Por revisar{openCount > 0 ? ` (${openCount})` : ""}
          </TabsTrigger>
          <TabsTrigger className="flex-none px-3" value="checadores">
            Checadores
          </TabsTrigger>
          <TabsTrigger className="flex-none px-3" value="numeros">
            Números
          </TabsTrigger>
          <TabsTrigger className="flex-none px-3" value="app">
            Checado en la app
          </TabsTrigger>
        </TabsList>

        <TabsContent className="flex flex-col gap-4" value="cargar">
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Cargar checadas</CardTitle>
                <CardDescription>
                  {activeDevices.length > 0
                    ? "Sube el archivo que exportó el checador. Se lee con el formato de ese checador."
                    : "Agrega primero un checador en la pestaña «Checadores»."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UploadChecadasForm
                  action={importChecadorCsvAction}
                  devices={activeDevices.map((device) => ({
                    id: device.id,
                    name: device.name,
                  }))}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Historial</CardTitle>
              <CardDescription>
                Cada archivo subido, y un renglón por checador y día para los
                envíos automáticos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {batches.items.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Aún no hay checadas cargadas.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Checador</TableHead>
                      <TableHead>Origen</TableHead>
                      <TableHead className="text-right">Filas</TableHead>
                      <TableHead className="text-right">Nuevas</TableHead>
                      <TableHead className="text-right">Ya estaban</TableHead>
                      <TableHead className="text-right">Sin persona</TableHead>
                      <TableHead className="text-right">Con error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.items.map((batch) => (
                      <TableRow key={batch.id}>
                        <TableCell>
                          {batch.source === "device" && batch.pushDay
                            ? formatDateMx(batch.pushDay)
                            : formatDateTimeMx(batch.createdAt)}
                        </TableCell>
                        <TableCell>{batch.deviceName}</TableCell>
                        <TableCell className="text-sm">
                          {batch.source === "device"
                            ? "Envío del checador"
                            : `${batch.fileName ?? "Archivo"}${batch.createdByName ? ` · ${batch.createdByName}` : ""}`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {batch.rows}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {batch.punchesAdded}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {batch.duplicates}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {batch.unmatched}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {batch.invalid}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {nextLink(batches.next)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="flex flex-col gap-4" value="revisar">
          <Card>
            <CardHeader>
              <CardTitle>Checadas sin persona o con error</CardTitle>
              <CardDescription>
                Cada renglón trae la fila tal como llegó. Asigna el número a una
                persona y sus checadas pendientes se registran; descarta lo que
                no sea una checada.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {unmatched.items.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No hay checadas por revisar.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Checador</TableHead>
                      <TableHead>Número</TableHead>
                      <TableHead>Checada</TableHead>
                      <TableHead>Fila original</TableHead>
                      {canManage ? (
                        <TableHead className="text-right">Acciones</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unmatched.items.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Badge
                            tone={
                              row.reason === "unknown_badge"
                                ? "warning"
                                : "danger"
                            }
                          >
                            {row.reason === "unknown_badge"
                              ? "Número sin persona"
                              : "No se pudo leer"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.deviceName}
                          <span className="text-muted-foreground block text-xs">
                            Línea {row.line}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {row.badge ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.punchedAt
                            ? `${formatDateTimeMx(row.punchedAt)}${row.kind ? ` · ${kindLabel(row.kind)}` : ""}`
                            : "—"}
                        </TableCell>
                        <TableCell className="max-w-72 font-mono text-xs break-all whitespace-normal">
                          {row.raw.join(" | ")}
                        </TableCell>
                        {canManage ? (
                          <TableCell className="text-right">
                            <div className="flex flex-col items-end gap-2">
                              {row.reason === "unknown_badge" && row.badge ? (
                                <details className="w-64 text-left whitespace-normal">
                                  <summary className="cursor-pointer text-sm">
                                    Asignar a una persona
                                  </summary>
                                  <div className="pt-2">
                                    <AssignBadgeForm
                                      action={assignBadgeAction}
                                      badge={row.badge}
                                    />
                                  </div>
                                </details>
                              ) : null}
                              <ActionButton
                                action={dismissUnmatchedAction}
                                fields={{ unmatchedId: row.id }}
                                variant="ghost"
                              >
                                Descartar
                              </ActionButton>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {nextLink(unmatched.next)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="flex flex-col gap-4" value="checadores">
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Agregar checador</CardTitle>
                <CardDescription>
                  Describe cómo viene su archivo una sola vez; cada carga se lee
                  igual. Si el checador puede enviar sus checadas, crea su token
                  de envío.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DeviceForm action={saveAttendanceDeviceAction} sites={sites} />
              </CardContent>
            </Card>
          ) : null}

          {devices.map((device) => (
            <Card key={device.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {device.name}
                  {device.active ? null : (
                    <Badge tone="neutral">Desactivado</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {device.siteName ?? "La sucursal de cada persona"}
                  {device.hasToken
                    ? ` · Token de envío …${device.tokenHint ?? ""}`
                    : " · Sin token de envío"}
                  {device.lastPushAt
                    ? ` · Último envío ${formatDateTimeMx(device.lastPushAt)}`
                    : ""}
                </CardDescription>
              </CardHeader>
              {canManage ? (
                <CardContent className="space-y-4">
                  {device.active ? (
                    <details>
                      <summary className="cursor-pointer text-sm">
                        Editar nombre, ubicación y formato
                      </summary>
                      <div className="pt-3">
                        <DeviceForm
                          action={saveAttendanceDeviceAction}
                          device={device}
                          sites={sites}
                        />
                      </div>
                    </details>
                  ) : null}
                  <div className="flex flex-wrap items-start gap-3">
                    {device.active ? (
                      <DeviceTokenForm
                        action={issueDeviceTokenAction}
                        deviceId={device.id}
                        hasToken={device.hasToken}
                      />
                    ) : null}
                    <ActionButton
                      action={setAttendanceDeviceActiveAction}
                      confirm={
                        device.active
                          ? "¿Desactivar este checador? Su token deja de funcionar."
                          : undefined
                      }
                      fields={{
                        deviceId: device.id,
                        active: device.active ? "false" : "true",
                      }}
                      variant="ghost"
                    >
                      {device.active ? "Desactivar" : "Activar"}
                    </ActionButton>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle>Envío automático</CardTitle>
              <CardDescription>
                Para checadores o programas que pueden mandar sus checadas por
                internet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <code className="font-mono text-xs">
                  POST /api/asistencia/checadas
                </code>{" "}
                con el encabezado{" "}
                <code className="font-mono text-xs">
                  Authorization: Bearer &lt;token&gt;
                </code>{" "}
                y el cuerpo:
              </p>
              <pre className="bg-muted/50 overflow-x-auto rounded-md p-3 font-mono text-xs">
                {`{ "punches": [
  { "badge": "123", "at": "2026-11-03 08:12:00", "kind": "in" }
] }`}
              </pre>
              <p className="text-muted-foreground">
                Hasta 1,000 checadas por envío. «kind» es opcional. Repetir un
                envío no duplica nada.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="flex flex-col gap-4" value="numeros">
          {canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>Asignar número</CardTitle>
                <CardDescription>
                  El número de la persona en los checadores, el mismo en todos.
                  Los ceros a la izquierda no cuentan.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AssignBadgeForm action={assignBadgeAction} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Números asignados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {badges.items.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Aún no hay números asignados.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Número</TableHead>
                      <TableHead>Persona</TableHead>
                      {canManage ? (
                        <TableHead className="text-right">Acciones</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {badges.items.map((badge) => (
                      <TableRow key={badge.id}>
                        <TableCell className="font-mono">
                          {badge.badge}
                        </TableCell>
                        <TableCell>
                          <Link
                            className="underline-offset-4 hover:underline"
                            href={`/app/personas/${badge.personId}`}
                          >
                            {formatPersonName(badge)}
                          </Link>
                        </TableCell>
                        {canManage ? (
                          <TableCell className="text-right">
                            <ActionButton
                              action={removeBadgeAction}
                              confirm="¿Quitar este número? Las checadas ya registradas se quedan."
                              fields={{ badgeId: badge.id }}
                              variant="ghost"
                            >
                              Quitar
                            </ActionButton>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {nextLink(badges.next)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="flex flex-col gap-4" value="app">
          <Card>
            <CardHeader>
              <CardTitle>Checado en la app</CardTitle>
              <CardDescription>
                La persona escanea con su teléfono el código QR de la sucursal y
                la app confirma con su ubicación que está dentro del radio. La
                ubicación no se guarda.
              </CardDescription>
            </CardHeader>
          </Card>

          {checkinSites.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Agrega ubicaciones en el catálogo para activar el checado en la
              app.
            </p>
          ) : null}

          {checkinSites.map((site) => (
            <Card key={site.siteId}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {site.siteName}
                  {site.latitude === null ? (
                    <Badge tone="neutral">Sin configurar</Badge>
                  ) : site.enabled ? (
                    <Badge tone="success">Activo</Badge>
                  ) : (
                    <Badge tone="neutral">Inactivo</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {canManage ? (
                  <CheckinSiteForm action={saveCheckinSiteAction} site={site} />
                ) : site.latitude !== null ? (
                  <p className="text-sm">
                    {site.latitude}, {site.longitude} · radio{" "}
                    {site.radiusMeters} m
                  </p>
                ) : null}
                {canManage && site.latitude !== null && site.enabled ? (
                  <div className="flex flex-wrap items-start gap-3">
                    <Link
                      className="text-sm underline-offset-4 hover:underline"
                      href={`/app/asistencia/qr/${site.siteId}`}
                      target="_blank"
                    >
                      {site.qrMode === "printed"
                        ? "Ver código para imprimir"
                        : "Abrir pantalla con el código"}
                    </Link>
                    <ActionButton
                      action={rotateCheckinSecretAction}
                      confirm="Los códigos mostrados o impresos dejarán de funcionar. ¿Continuar?"
                      fields={{ siteId: site.siteId }}
                      variant="ghost"
                    >
                      Invalidar códigos anteriores
                    </ActionButton>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AsistenciaPage;
