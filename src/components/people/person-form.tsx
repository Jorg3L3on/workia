"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  Area,
  Person,
  PersonSchedule,
  Position,
  Site,
} from "@/lib/db/schema";
import {
  createPersonAction,
  updatePersonAction,
  type PersonActionState,
} from "@/lib/people/actions";
import {
  PERSON_STATUSES,
  SCHEDULE_FIELD_LABELS,
  personStatusLabels,
  type PersonFormValues,
} from "@/lib/people/schema";
import { siteKindLabels } from "@/lib/sites/schema";

type SelectPerson = Pick<
  Person,
  "id" | "nombres" | "apellidoPaterno" | "apellidoMaterno"
>;

type PersonFormProps = {
  mode: "create" | "edit";
  person?: Person;
  schedule?: PersonSchedule | null;
  areas: Area[];
  positions: Position[];
  sites: Site[];
  managers: SelectPerson[];
};

const initialState: PersonActionState = {};

const SubmitButton = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();

  return (
    <Button
      className="workia-accent-gradient border-0 text-white shadow-md hover:opacity-95"
      disabled={pending}
      type="submit"
    >
      {pending ? "Guardando…" : label}
    </Button>
  );
};

const formatSelectPerson = (person: SelectPerson) =>
  [person.nombres, person.apellidoPaterno, person.apellidoMaterno]
    .filter(Boolean)
    .join(" ");

export const PersonForm = ({
  mode,
  person,
  schedule,
  areas,
  positions,
  sites,
  managers,
}: PersonFormProps) => {
  const action =
    mode === "create"
      ? createPersonAction
      : updatePersonAction.bind(null, person!.id);

  const [state, formAction] = useActionState(action, initialState);

  const defaultValues: PersonFormValues = {
    nombres: person?.nombres ?? "",
    apellidoPaterno: person?.apellidoPaterno ?? "",
    apellidoMaterno: person?.apellidoMaterno ?? "",
    email: person?.email ?? "",
    telefono: person?.telefono ?? "",
    fechaNacimiento: person?.fechaNacimiento ?? "",
    fechaIngreso: person?.fechaIngreso ?? "",
    areaId: person?.areaId ?? "",
    positionId: person?.positionId ?? "",
    managerId: person?.managerId ?? "",
    siteId: person?.siteId ?? "",
    rfc: person?.rfc ?? "",
    curp: person?.curp ?? "",
    nss: person?.nss ?? "",
    horarioEntrada: schedule?.entrada ?? "",
    horarioSalidaComer: schedule?.salidaComer ?? "",
    horarioRegresoComer: schedule?.regresoComer ?? "",
    horarioSalida: schedule?.salida ?? "",
    status: person?.status ?? "activa",
  };

  const activeAreas = areas.filter((area) => !area.deletedAt && area.active);
  const activePositions = positions.filter(
    (position) => !position.deletedAt && position.active,
  );
  const activeSites = sites.filter((site) => !site.deletedAt);

  return (
    <form action={formAction} className="workia-pass-card space-y-6 p-5 sm:p-6">
      <div className="space-y-1">
        <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
          Expediente
        </p>
        <h2 className="text-lg font-semibold tracking-tight">
          {mode === "create" ? "Nueva persona" : "Editar persona"}
        </h2>
        <p className="text-muted-foreground text-sm">
          Datos de empresa e identificadores para el expediente del empleado.
        </p>
      </div>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Nombre</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="nombres">Nombre(s)</Label>
            <Input
              aria-invalid={Boolean(state.fieldErrors?.nombres)}
              defaultValue={defaultValues.nombres}
              id="nombres"
              name="nombres"
              placeholder="Ej. Persona"
              required
            />
            {state.fieldErrors?.nombres ? (
              <p className="text-destructive text-xs">
                {state.fieldErrors.nombres}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="apellidoPaterno">Apellido paterno</Label>
            <Input
              aria-invalid={Boolean(state.fieldErrors?.apellidoPaterno)}
              defaultValue={defaultValues.apellidoPaterno}
              id="apellidoPaterno"
              name="apellidoPaterno"
              placeholder="Ej. Demo"
              required
            />
            {state.fieldErrors?.apellidoPaterno ? (
              <p className="text-destructive text-xs">
                {state.fieldErrors.apellidoPaterno}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="apellidoMaterno">Apellido materno (opcional)</Label>
            <Input
              defaultValue={defaultValues.apellidoMaterno}
              id="apellidoMaterno"
              name="apellidoMaterno"
              placeholder="Opcional"
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Empresa</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fechaIngreso">Fecha de ingreso</Label>
            <Input
              defaultValue={defaultValues.fechaIngreso}
              id="fechaIngreso"
              name="fechaIngreso"
              type="date"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fechaNacimiento">Fecha de nacimiento</Label>
            <Input
              defaultValue={defaultValues.fechaNacimiento}
              id="fechaNacimiento"
              name="fechaNacimiento"
              type="date"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="areaId">Área</Label>
            <select
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
              defaultValue={defaultValues.areaId}
              id="areaId"
              name="areaId"
            >
              <option value="">Sin área</option>
              {activeAreas.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="positionId">Puesto</Label>
            <select
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
              defaultValue={defaultValues.positionId}
              id="positionId"
              name="positionId"
            >
              <option value="">Sin puesto</option>
              {activePositions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="siteId">Ubicación (dónde trabaja)</Label>
            <select
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
              defaultValue={defaultValues.siteId}
              id="siteId"
              name="siteId"
            >
              <option value="">Sin ubicación</option>
              {activeSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ({siteKindLabels[site.kind]})
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">
              Corporativo o sucursal — no confundir con el área (función).
            </p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="managerId">Jefe directo</Label>
            <select
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
              defaultValue={defaultValues.managerId}
              id="managerId"
              name="managerId"
            >
              <option value="">Sin jefe directo</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {formatSelectPerson(manager)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Horario</h3>
        <p className="text-muted-foreground text-xs">
          Horario de esta persona — no del puesto ni de la sucursal.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="horarioEntrada">
              {SCHEDULE_FIELD_LABELS.horarioEntrada}
            </Label>
            <Input
              aria-invalid={Boolean(state.fieldErrors?.horarioEntrada)}
              defaultValue={defaultValues.horarioEntrada}
              id="horarioEntrada"
              name="horarioEntrada"
              type="time"
            />
            {state.fieldErrors?.horarioEntrada ? (
              <p className="text-destructive text-xs">
                {state.fieldErrors.horarioEntrada}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="horarioSalidaComer">
              {SCHEDULE_FIELD_LABELS.horarioSalidaComer}
            </Label>
            <Input
              aria-invalid={Boolean(state.fieldErrors?.horarioSalidaComer)}
              defaultValue={defaultValues.horarioSalidaComer}
              id="horarioSalidaComer"
              name="horarioSalidaComer"
              type="time"
            />
            {state.fieldErrors?.horarioSalidaComer ? (
              <p className="text-destructive text-xs">
                {state.fieldErrors.horarioSalidaComer}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="horarioRegresoComer">
              {SCHEDULE_FIELD_LABELS.horarioRegresoComer}
            </Label>
            <Input
              aria-invalid={Boolean(state.fieldErrors?.horarioRegresoComer)}
              defaultValue={defaultValues.horarioRegresoComer}
              id="horarioRegresoComer"
              name="horarioRegresoComer"
              type="time"
            />
            {state.fieldErrors?.horarioRegresoComer ? (
              <p className="text-destructive text-xs">
                {state.fieldErrors.horarioRegresoComer}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="horarioSalida">
              {SCHEDULE_FIELD_LABELS.horarioSalida}
            </Label>
            <Input
              aria-invalid={Boolean(state.fieldErrors?.horarioSalida)}
              defaultValue={defaultValues.horarioSalida}
              id="horarioSalida"
              name="horarioSalida"
              type="time"
            />
            {state.fieldErrors?.horarioSalida ? (
              <p className="text-destructive text-xs">
                {state.fieldErrors.horarioSalida}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Identificadores y contacto</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rfc">RFC</Label>
            <Input
              defaultValue={defaultValues.rfc}
              id="rfc"
              name="rfc"
              placeholder="XAXX010101000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="curp">CURP</Label>
            <Input
              defaultValue={defaultValues.curp}
              id="curp"
              name="curp"
              placeholder="XAXX010101HDFXXX00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nss">NSS (opcional)</Label>
            <Input
              defaultValue={defaultValues.nss}
              id="nss"
              name="nss"
              placeholder="00000000000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="telefono">Teléfono (opcional)</Label>
            <Input
              defaultValue={defaultValues.telefono}
              id="telefono"
              name="telefono"
              placeholder="5550000000"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="email">Correo (opcional)</Label>
            <Input
              defaultValue={defaultValues.email}
              id="email"
              name="email"
              placeholder="persona.demo@ejemplo.local"
              type="email"
            />
          </div>
        </div>
      </section>

      <div className="space-y-2">
        <Label htmlFor="status">Relación laboral</Label>
        <select
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3 sm:w-60"
          defaultValue={defaultValues.status}
          id="status"
          name="status"
          required
        >
          {PERSON_STATUSES.map((status) => (
            <option key={status} value={status}>
              {personStatusLabels[status]}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          Baja laboral no borra el expediente. El borrado lógico es una acción
          aparte.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <SubmitButton
          label={mode === "create" ? "Dar de alta" : "Guardar cambios"}
        />
        <Button asChild variant="outline">
          <Link
            href={
              mode === "create"
                ? "/app/personas"
                : `/app/personas/${person!.id}`
            }
          >
            Cancelar
          </Link>
        </Button>
        {mode === "edit" && person ? (
          <Badge variant={person.status === "activa" ? "default" : "secondary"}>
            {personStatusLabels[person.status]}
          </Badge>
        ) : null}
      </div>
    </form>
  );
};
