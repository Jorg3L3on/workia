"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { ManagerPicker } from "@/components/people/manager-picker";
import { CompanyField } from "@/components/tenant/company-context";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  kioskCodeAction,
  searchAttendancePeopleAction,
  type AttendanceActionState,
  type KioskCode,
} from "@/lib/attendance/actions";
import {
  CSV_FORMAT_PRESETS,
  DATE_FORMATS,
  dateFormatLabels,
} from "@/lib/attendance/csv-format";
import type { AttendanceCsvFormat } from "@/lib/db/schema/attendance";

export type AttendanceFormAction = (
  state: AttendanceActionState,
  formData: FormData,
) => Promise<AttendanceActionState>;

/** Submits to a server action and keeps its answer; resets the form on success. */
const useActionForm = (
  action: AttendanceFormAction,
  options: { reset?: boolean; onDone?: () => void } = {},
) => {
  const [state, setState] = useState<AttendanceActionState>({});
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setPending(true);
    setState({});

    try {
      const next = await action({}, data);

      setState(next);

      if (next.ok) {
        if (options.reset !== false) form.reset();
        options.onDone?.();
      }
    } finally {
      setPending(false);
    }
  };

  return { state, pending, onSubmit };
};

const FormMessage = ({ state }: { state: AttendanceActionState }) =>
  state.error ? (
    <p className="text-destructive text-sm" role="alert">
      {state.error}
    </p>
  ) : state.message ? (
    <p className="text-sm" role="status">
      {state.message}
    </p>
  ) : null;

const SubmitButton = ({
  pending,
  children,
  variant,
}: {
  pending: boolean;
  children: ReactNode;
  variant?: "secondary" | "ghost" | "destructive";
}) => (
  <Button
    aria-busy={pending}
    disabled={pending}
    type="submit"
    variant={variant}
  >
    {pending ? "Guardando…" : children}
  </Button>
);

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("es-MX")} ${count === 1 ? one : many}`;

// ---------------------------------------------------------------- upload

export const UploadChecadasForm = ({
  devices,
  action,
}: {
  devices: Array<{ id: string; name: string }>;
  action: AttendanceFormAction;
}) => {
  const { state, pending, onSubmit } = useActionForm(action);
  const summary = state.summary;

  return (
    <form className="space-y-3" noValidate onSubmit={onSubmit}>
      <CompanyField />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="upload-device">Checador</Label>
          <FormSelect
            defaultValue={devices[0]?.id ?? ""}
            id="upload-device"
            name="deviceId"
            options={devices.map((device) => ({
              value: device.id,
              label: device.name,
            }))}
            placeholder="Elige el checador"
            variant="field"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="upload-file">Archivo que exportó (CSV o texto)</Label>
          <Input
            accept=".csv,.txt,.dat,.tsv,text/csv,text/plain"
            id="upload-file"
            name="file"
            type="file"
          />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Puedes subir el mismo archivo otra vez: las checadas que ya están no se
        duplican.
      </p>
      <FormMessage state={state} />
      {summary ? (
        <div
          className="bg-muted/50 space-y-1 rounded-md px-3 py-2 text-sm"
          role="status"
        >
          <p className="font-medium">
            {plural(summary.punchesAdded, "checada nueva", "checadas nuevas")}{" "}
            de {plural(summary.rows, "fila", "filas")}.
          </p>
          <p className="text-muted-foreground">
            {plural(summary.duplicates, "ya estaba", "ya estaban")} ·{" "}
            {plural(summary.unmatched, "sin persona", "sin persona")} ·{" "}
            {plural(summary.invalid, "fila con error", "filas con error")}
          </p>
          {summary.unmatched + summary.invalid > 0 ? (
            <p className="text-muted-foreground">
              Revisa la pestaña «Por revisar».
            </p>
          ) : null}
        </div>
      ) : null}
      <Button
        aria-busy={pending}
        disabled={pending || devices.length === 0}
        type="submit"
      >
        {pending ? "Cargando…" : "Cargar checadas"}
      </Button>
    </form>
  );
};

// ---------------------------------------------------------------- checadores

type DeviceFormValues = {
  id?: string;
  name: string;
  siteId: string | null;
  csvFormat: AttendanceCsvFormat;
};

const delimiterOptions = [
  { value: "auto", label: "Detectar" },
  { value: ",", label: "Coma ( , )" },
  { value: ";", label: "Punto y coma ( ; )" },
  { value: "tab", label: "Tabulador" },
];

/** A checador: its name, its site and how its export reads. */
export const DeviceForm = ({
  device,
  sites,
  action,
}: {
  device?: DeviceFormValues;
  sites: Array<{ id: string; name: string }>;
  action: AttendanceFormAction;
}) => {
  const [format, setFormat] = useState<AttendanceCsvFormat>(
    device?.csvFormat ?? CSV_FORMAT_PRESETS[0].format,
  );
  const [split, setSplit] = useState(
    Boolean(format.dateColumn && !format.dateTimeColumn),
  );
  const [presetKey, setPresetKey] = useState(0);
  const { state, pending, onSubmit } = useActionForm(action, {
    reset: !device,
  });
  const idPrefix = device?.id ?? "new";

  const applyPreset = (id: string) => {
    const preset = CSV_FORMAT_PRESETS.find((item) => item.id === id);

    if (!preset) return;

    setFormat(preset.format);
    setSplit(Boolean(preset.format.dateColumn));
    setPresetKey((value) => value + 1);
  };

  return (
    <form className="space-y-3" noValidate onSubmit={onSubmit}>
      <CompanyField />
      {device?.id ? (
        <input name="deviceId" type="hidden" value={device.id} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-name`}>Nombre</Label>
          <Input
            defaultValue={device?.name ?? ""}
            id={`${idPrefix}-name`}
            maxLength={80}
            name="name"
            placeholder="Checador entrada Norte"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-site`}>Ubicación</Label>
          <FormSelect
            defaultValue={device?.siteId ?? ""}
            id={`${idPrefix}-site`}
            name="siteId"
            options={[
              { value: "", label: "La sucursal de cada persona" },
              ...sites.map((site) => ({ value: site.id, label: site.name })),
            ]}
            variant="field"
          />
        </div>
      </div>

      <fieldset className="space-y-3 rounded-md border px-3 py-3">
        <legend className="px-1 text-sm font-medium">
          Formato del archivo
        </legend>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-preset`}>Empezar desde</Label>
          <FormSelect
            id={`${idPrefix}-preset`}
            onValueChange={applyPreset}
            options={CSV_FORMAT_PRESETS.map((preset) => ({
              value: preset.id,
              label: preset.label,
            }))}
            placeholder="Un formato común (ajústalo a tu archivo)"
            variant="field"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3" key={presetKey}>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-delimiter`}>Separador</Label>
            <FormSelect
              defaultValue={
                format.delimiter === "\t" ? "tab" : format.delimiter
              }
              id={`${idPrefix}-delimiter`}
              name="delimiter"
              options={delimiterOptions}
              variant="field"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-header`}>Filas de encabezado</Label>
            <Input
              defaultValue={format.headerRows}
              id={`${idPrefix}-header`}
              max={5}
              min={0}
              name="headerRows"
              type="number"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-badge`}>Columna del número</Label>
            <Input
              defaultValue={format.badgeColumn}
              id={`${idPrefix}-badge`}
              name="badgeColumn"
              placeholder="1 o «No.»"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={split}
                onChange={(event) => setSplit(event.target.checked)}
                type="checkbox"
              />
              La fecha y la hora vienen en columnas separadas
            </label>
          </div>
          {split ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-date`}>Columna de fecha</Label>
                <Input
                  defaultValue={format.dateColumn ?? ""}
                  id={`${idPrefix}-date`}
                  name="dateColumn"
                  placeholder="2 o «Fecha»"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${idPrefix}-time`}>Columna de hora</Label>
                <Input
                  defaultValue={format.timeColumn ?? ""}
                  id={`${idPrefix}-time`}
                  name="timeColumn"
                  placeholder="3 o «Hora»"
                />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor={`${idPrefix}-datetime`}>
                Columna de fecha y hora
              </Label>
              <Input
                defaultValue={format.dateTimeColumn ?? ""}
                id={`${idPrefix}-datetime`}
                name="dateTimeColumn"
                placeholder="2 o «Fecha/Hora»"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-dateformat`}>
              Cómo viene la fecha
            </Label>
            <FormSelect
              defaultValue={format.dateFormat}
              id={`${idPrefix}-dateformat`}
              name="dateFormat"
              options={DATE_FORMATS.map((value) => ({
                value,
                label: dateFormatLabels[value],
              }))}
              variant="field"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-kind`}>
              Columna entrada/salida (opcional)
            </Label>
            <Input
              defaultValue={format.kindColumn ?? ""}
              id={`${idPrefix}-kind`}
              name="kindColumn"
              placeholder="4 o «Estado»"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-in`}>Valores de entrada</Label>
            <Input
              defaultValue={(format.inValues ?? []).join(", ")}
              id={`${idPrefix}-in`}
              name="inValues"
              placeholder="0, E, Entrada"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-out`}>Valores de salida</Label>
            <Input
              defaultValue={(format.outValues ?? []).join(", ")}
              id={`${idPrefix}-out`}
              name="outValues"
              placeholder="1, S, Salida"
            />
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          Las columnas se indican por número (1 es la primera) o por el nombre
          del encabezado. Las horas se leen en hora del centro de México. Sin
          columna de entrada/salida, las checadas de cada día se toman en orden:
          entrada, salida, entrada…
        </p>
      </fieldset>

      <FormMessage state={state} />
      <SubmitButton pending={pending}>
        {device?.id ? "Guardar checador" : "Agregar checador"}
      </SubmitButton>
    </form>
  );
};

/** Issues a push token and shows it once. */
export const DeviceTokenForm = ({
  deviceId,
  hasToken,
  action,
}: {
  deviceId: string;
  hasToken: boolean;
  action: AttendanceFormAction;
}) => {
  const { state, pending, onSubmit } = useActionForm(action, { reset: false });

  return (
    <form className="space-y-2" noValidate onSubmit={onSubmit}>
      <CompanyField />
      <input name="deviceId" type="hidden" value={deviceId} />
      {state.token ? (
        <div className="space-y-1">
          <Label htmlFor={`token-${deviceId}`}>Token de envío</Label>
          <Input
            className="font-mono text-xs"
            id={`token-${deviceId}`}
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            value={state.token}
          />
        </div>
      ) : null}
      <FormMessage state={state} />
      <SubmitButton pending={pending} variant="secondary">
        {hasToken ? "Cambiar token de envío" : "Crear token de envío"}
      </SubmitButton>
    </form>
  );
};

/** A one-button form: hidden fields plus a submit. */
export const ActionButton = ({
  action,
  fields,
  children,
  variant = "secondary",
  confirm,
}: {
  action: AttendanceFormAction;
  fields: Record<string, string>;
  children: ReactNode;
  variant?: "secondary" | "ghost" | "destructive";
  confirm?: string;
}) => {
  const { state, pending, onSubmit } = useActionForm(action, { reset: false });

  return (
    <form
      className="inline-flex flex-col items-start gap-1"
      noValidate
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) {
          event.preventDefault();
          return;
        }

        void onSubmit(event);
      }}
    >
      <CompanyField />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}
      <SubmitButton pending={pending} variant={variant}>
        {children}
      </SubmitButton>
      {state.error ? (
        <p className="text-destructive text-xs" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
};

// ---------------------------------------------------------------- numbers

/** Gives a checador number to a person; pending punches with it are placed. */
export const AssignBadgeForm = ({
  badge,
  action,
}: {
  badge?: string | null;
  action: AttendanceFormAction;
}) => {
  const [key, setKey] = useState(0);
  const { state, pending, onSubmit } = useActionForm(action, {
    onDone: () => setKey((value) => value + 1),
  });
  const idPrefix = badge ? `assign-${badge}` : "assign-new";

  return (
    <form className="space-y-3" noValidate onSubmit={onSubmit}>
      <CompanyField />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-badge`}>Número</Label>
          {badge ? (
            <>
              <input name="badge" type="hidden" value={badge} />
              <p className="font-mono text-sm" id={`${idPrefix}-badge`}>
                {badge}
              </p>
            </>
          ) : (
            <Input
              id={`${idPrefix}-badge`}
              maxLength={40}
              name="badge"
              placeholder="123"
            />
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-person`}>Persona</Label>
          <ManagerPicker
            id={`${idPrefix}-person`}
            initial={null}
            key={key}
            name="personId"
            placeholder="Busca por nombre o CURP"
            search={searchAttendancePeopleAction}
            selectedPrefix="Persona"
          />
        </div>
      </div>
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Asignar número</SubmitButton>
    </form>
  );
};

// ---------------------------------------------------------------- app check-in

export const CheckinSiteForm = ({
  site,
  action,
}: {
  site: {
    siteId: string;
    latitude: number | null;
    longitude: number | null;
    radiusMeters: number | null;
    qrMode: "rotating" | "printed" | null;
    enabled: boolean | null;
  };
  action: AttendanceFormAction;
}) => {
  const { state, pending, onSubmit } = useActionForm(action, { reset: false });
  const id = `checkin-${site.siteId}`;

  return (
    <form className="space-y-3" noValidate onSubmit={onSubmit}>
      <CompanyField />
      <input name="siteId" type="hidden" value={site.siteId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-lat`}>Latitud</Label>
          <Input
            defaultValue={site.latitude ?? ""}
            id={`${id}-lat`}
            inputMode="decimal"
            name="latitude"
            placeholder="19.4326"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-lng`}>Longitud</Label>
          <Input
            defaultValue={site.longitude ?? ""}
            id={`${id}-lng`}
            inputMode="decimal"
            name="longitude"
            placeholder="-99.1332"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-radius`}>Radio (metros)</Label>
          <Input
            defaultValue={site.radiusMeters ?? 150}
            id={`${id}-radius`}
            max={2000}
            min={25}
            name="radiusMeters"
            type="number"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-mode`}>Código QR</Label>
          <FormSelect
            defaultValue={site.qrMode ?? "rotating"}
            id={`${id}-mode`}
            name="qrMode"
            options={[
              { value: "rotating", label: "En pantalla (cambia)" },
              { value: "printed", label: "Impreso" },
            ]}
            variant="field"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          defaultChecked={site.enabled ?? true}
          name="enabled"
          type="checkbox"
          value="true"
        />
        Activo
      </label>
      <input name="enabled" type="hidden" value="false" />
      <FormMessage state={state} />
      <SubmitButton pending={pending}>Guardar</SubmitButton>
    </form>
  );
};

/** The kiosk QR: asks for the next code when the current one is about to change. */
export const KioskQr = ({ siteId }: { siteId: string }) => {
  const [code, setCode] = useState<KioskCode | undefined>(undefined);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const load = async () => {
      const next = await kioskCodeAction(siteId).catch(() => null);

      if (stopped) return;

      setCode(next);
      timer = setTimeout(load, next?.refreshInMs ?? 60_000);
    };

    void load();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [siteId]);

  if (code === undefined) {
    return <p className="text-muted-foreground text-sm">Cargando código…</p>;
  }

  if (code === null) {
    return (
      <p className="text-destructive text-sm" role="alert">
        El checado en la app no está activo en esta ubicación.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        aria-label="Código QR para checar"
        className="w-full max-w-md bg-white p-4 [&_svg]:h-auto [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: code.svg }}
        role="img"
      />
      <p className="text-muted-foreground text-center text-sm">
        {code.refreshInMs
          ? "El código cambia cada minuto."
          : "Código impreso: sirve hasta que se invalide."}
      </p>
    </div>
  );
};
