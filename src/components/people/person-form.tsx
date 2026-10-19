"use client";

import Link from "next/link";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormSelect } from "@/components/ui/form-select";
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
  BeneficiariesEditor,
  type BeneficiaryRow,
} from "@/components/people/beneficiaries-editor";
import { ManagerPicker } from "@/components/people/manager-picker";
import { ScheduleBlocksEditor } from "@/components/people/schedule-blocks-editor";
import {
  createPersonAction,
  type ManagerOption,
  updatePersonAction,
  type PersonActionState,
} from "@/lib/people/actions";
import {
  MARITAL_STATUSES,
  MX_STATES,
  SEXES,
  maritalStatusLabels,
  scheduleBlocksOf,
  sexLabels,
  type PersonFormValues,
} from "@/lib/people/schema";
import { siteKindLabels } from "@/lib/sites/schema";
import { CompanyField } from "@/components/tenant/company-context";
import { cn } from "@/lib/utils";

type PersonFormProps = {
  mode: "create" | "edit";
  person?: Person;
  schedule?: PersonSchedule | null;
  areas: Area[];
  positions: Position[];
  sites: Site[];
  /** Current manager, shown in the picker; other candidates load as the user types. */
  initialManager?: ManagerOption | null;
  beneficiaries?: BeneficiaryRow[];
};

const stateOptions = (empty: string) => [
  { value: "", label: empty },
  ...MX_STATES.map((state) => ({ value: state, label: state })),
];

const initialState: PersonActionState = {};

const SECTIONS = [
  {
    id: "nombre",
    title: "Nombre",
    help: "Como aparece en la CURP y en los contratos.",
  },
  {
    id: "empresa",
    title: "Empresa",
    help: "Ingreso, ubicación y lugar en la organización.",
  },
  {
    id: "horario",
    title: "Horario",
    help: "El horario de esta persona, no el del puesto ni el de la sucursal.",
  },
  {
    id: "identificadores",
    title: "Identificadores",
    help: "Identificadores fiscales y datos de contacto.",
  },
  {
    id: "datos-mexico",
    title: "Datos México",
    help: "Domicilio, datos civiles e INE para el expediente oficial.",
  },
  {
    id: "beneficiarios",
    title: "Beneficiarios",
    help: "Quién recibe las prestaciones; los porcentajes suman 100.",
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const sectionDomId = (id: SectionId) => `seccion-${id}`;

const FormSection = ({
  id,
  children,
  ...rest
}: {
  id: SectionId;
  children: ReactNode;
  "data-testid"?: string;
}) => {
  const section = SECTIONS.find((item) => item.id === id)!;

  return (
    <section
      aria-labelledby={`${sectionDomId(id)}-titulo`}
      className="workia-pass-card space-y-4 p-5 sm:p-6"
      data-section={id}
      id={sectionDomId(id)}
      {...rest}
    >
      <div className="space-y-1">
        <h2
          className="text-base font-semibold tracking-tight"
          id={`${sectionDomId(id)}-titulo`}
        >
          {section.title}
        </h2>
        <p className="text-muted-foreground text-sm">{section.help}</p>
      </div>
      {children}
    </section>
  );
};

/** Pages under /app scroll inside the shell, not the document. */
const scrollerOf = (element: Element) =>
  element.closest<HTMLElement>("[data-slot=shell-main-scroll]");

/** Space the sticky chips take above a section on phones. */
const sectionOffset = (root: HTMLElement) => {
  const nav = root.querySelector<HTMLElement>("[data-section-nav]");
  const horizontal = !window.matchMedia?.("(min-width: 768px)").matches;

  return (horizontal && nav ? nav.offsetHeight : 0) + 16;
};

/**
 * The section whose top last crossed the top of the scroller. A section
 * picked in the nav stays current until the user scrolls by hand, so the
 * short ones at the bottom can still be highlighted.
 */
const useActiveSection = (rootRef: RefObject<HTMLElement | null>) => {
  const [active, setActive] = useState<SectionId>(SECTIONS[0].id);
  const pinned = useRef<SectionId | null>(null);

  useEffect(() => {
    const root = rootRef.current;

    if (!root) {
      return;
    }

    const update = () => {
      if (pinned.current) {
        setActive(pinned.current);
        return;
      }

      const sections = SECTIONS.map((section) =>
        root.querySelector<HTMLElement>(`#${sectionDomId(section.id)}`),
      ).filter((element): element is HTMLElement => element !== null);
      const first = sections[0];

      if (!first) {
        return;
      }

      const scroller = scrollerOf(first);
      const top =
        (scroller?.getBoundingClientRect().top ?? 0) + sectionOffset(root);
      const box = scroller ?? document.documentElement;
      const atBottom =
        box.scrollTop > 0 &&
        box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
      const current = atBottom
        ? sections.at(-1)!
        : (sections.findLast(
            (element) => element.getBoundingClientRect().top <= top + 48,
          ) ?? first);

      setActive(current.dataset.section as SectionId);
    };
    const release = () => {
      pinned.current = null;
    };

    update();
    // Scroll events don't bubble; capture catches the shell's inner scroller.
    document.addEventListener("scroll", update, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", update);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchstart", release, { passive: true });
    window.addEventListener("keydown", release);

    return () => {
      document.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchstart", release);
      window.removeEventListener("keydown", release);
    };
  }, [rootRef]);

  const goTo = (id: SectionId) => {
    const root = rootRef.current;
    const element = root?.querySelector<HTMLElement>(`#${sectionDomId(id)}`);

    if (!root || !element) {
      return;
    }

    pinned.current = id;
    setActive(id);

    // Scroll only the shell's scroller: scrollIntoView would also shift the
    // shell's overflow-hidden wrapper once the scroller reaches its end.
    const scroller = scrollerOf(element);
    const delta =
      element.getBoundingClientRect().top -
      (scroller?.getBoundingClientRect().top ?? 0) -
      sectionOffset(root);

    (scroller ?? window).scrollBy({ top: delta, behavior: "smooth" });
  };

  // Phones: keep the current chip inside the horizontal strip.
  useEffect(() => {
    const nav =
      rootRef.current?.querySelector<HTMLElement>("[data-section-nav]");
    const chip = nav?.querySelector<HTMLElement>(
      `[href="#${sectionDomId(active)}"]`,
    );

    if (nav && chip && nav.scrollWidth > nav.clientWidth) {
      const left =
        chip.getBoundingClientRect().left -
        nav.getBoundingClientRect().left +
        nav.scrollLeft;

      nav.scrollTo({
        left: left - (nav.clientWidth - chip.offsetWidth) / 2,
        behavior: "smooth",
      });
    }
  }, [active, rootRef]);

  return [active, goTo] as const;
};

const countPendingRequired = (form: HTMLFormElement | null) =>
  form
    ? Array.from(
        form.querySelectorAll<HTMLInputElement>("input[required]"),
      ).filter((input) => input.value.trim() === "").length
    : 0;

const pendingLabel = (count: number) =>
  count === 0
    ? "Campos obligatorios completos"
    : count === 1
      ? "1 campo obligatorio pendiente"
      : `${count} campos obligatorios pendientes`;

const SubmitButton = ({ label }: { label: string }) => {
  const { pending } = useFormStatus();

  return (
    <Button disabled={pending} type="submit">
      {pending ? "Guardando…" : label}
    </Button>
  );
};

export const PersonForm = ({
  mode,
  person,
  schedule,
  areas,
  positions,
  sites,
  initialManager = null,
  beneficiaries = [],
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
    domicilioCalle: person?.domicilioCalle ?? "",
    domicilioNumeroExterior: person?.domicilioNumeroExterior ?? "",
    domicilioNumeroInterior: person?.domicilioNumeroInterior ?? "",
    domicilioColonia: person?.domicilioColonia ?? "",
    domicilioMunicipio: person?.domicilioMunicipio ?? "",
    domicilioEstado: (person?.domicilioEstado ??
      "") as PersonFormValues["domicilioEstado"],
    domicilioCodigoPostal: person?.domicilioCodigoPostal ?? "",
    estadoCivil: person?.estadoCivil ?? "",
    sexo: person?.sexo ?? "",
    lugarNacimiento: (person?.lugarNacimiento ??
      "") as PersonFormValues["lugarNacimiento"],
    nacionalidad: person?.nacionalidad ?? (person ? "" : "Mexicana"),
    ineClaveElector: person?.ineClaveElector ?? "",
  };
  const fieldError = (field: string) =>
    (state.fieldErrors as Record<string, string | undefined> | undefined)?.[
      field
    ];
  const errorText = (field: string) =>
    fieldError(field) ? (
      <p className="text-destructive text-xs">{fieldError(field)}</p>
    ) : null;

  const activeAreas = areas.filter((area) => !area.deletedAt && area.active);
  const activePositions = positions.filter(
    (position) => !position.deletedAt && position.active,
  );
  const activeSites = sites.filter((site) => !site.deletedAt);

  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(2);
  const [activeSection, goToSection] = useActiveSection(formRef);
  const refreshPending = useCallback(
    () => setPending(countPendingRequired(formRef.current)),
    [],
  );

  useEffect(refreshPending, [refreshPending]);

  const cancelHref =
    mode === "create" ? "/app/personas" : `/app/personas/${person!.id}`;

  return (
    <form
      action={formAction}
      className="space-y-6"
      onChange={refreshPending}
      onInput={refreshPending}
      ref={formRef}
    >
      <CompanyField />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === "create" ? "Nueva persona" : "Editar persona"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {mode === "create"
            ? "La persona se da de alta activa; los campos sin marca son obligatorios."
            : "Los campos sin marca son obligatorios."}
        </p>
      </div>

      {state.error ? (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[11rem_minmax(0,1fr)] md:gap-8">
        <nav
          aria-label="Secciones del formulario"
          data-section-nav=""
          className="bg-background sticky -top-4 z-10 -mx-4 overflow-x-auto px-4 py-2 md:top-0 md:mx-0 md:self-start md:overflow-visible md:bg-transparent md:p-0"
        >
          <ul className="flex gap-2 md:flex-col md:gap-0.5">
            {SECTIONS.map((section) => {
              const current = activeSection === section.id;

              return (
                <li className="shrink-0" key={section.id}>
                  <a
                    aria-current={current ? "location" : undefined}
                    className={cn(
                      "block rounded-full border px-3 py-1 text-sm whitespace-nowrap transition-colors md:rounded-lg md:border-transparent md:px-2.5 md:py-1.5",
                      current
                        ? "bg-primary/10 text-primary md:bg-muted md:text-foreground border-transparent font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                    )}
                    href={`#${sectionDomId(section.id)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      goToSection(section.id);
                    }}
                  >
                    {section.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          <FormSection id="nombre">
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
                {errorText("nombres")}
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
                {errorText("apellidoPaterno")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="apellidoMaterno">
                  Apellido materno (opcional)
                </Label>
                <Input
                  defaultValue={defaultValues.apellidoMaterno}
                  id="apellidoMaterno"
                  name="apellidoMaterno"
                />
              </div>
            </div>
          </FormSection>

          <FormSection id="empresa">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fechaIngreso">
                  Fecha de ingreso (opcional)
                </Label>
                <DateInput
                  defaultValue={defaultValues.fechaIngreso}
                  id="fechaIngreso"
                  name="fechaIngreso"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fechaNacimiento">
                  Fecha de nacimiento (opcional)
                </Label>
                <DateInput
                  defaultValue={defaultValues.fechaNacimiento}
                  id="fechaNacimiento"
                  name="fechaNacimiento"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="siteId">Ubicación (opcional)</Label>
                <FormSelect
                  defaultValue={defaultValues.siteId}
                  id="siteId"
                  name="siteId"
                  options={[
                    { value: "", label: "Sin ubicación" },
                    ...activeSites.map((site) => ({
                      value: site.id,
                      label: `${site.name} (${siteKindLabels[site.kind]})`,
                    })),
                  ]}
                  variant="field"
                />
                <p className="text-muted-foreground text-xs">
                  Corporativo o sucursal donde trabaja.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="areaId">Área (opcional)</Label>
                <FormSelect
                  defaultValue={defaultValues.areaId}
                  id="areaId"
                  name="areaId"
                  options={[
                    { value: "", label: "Sin área" },
                    ...activeAreas.map((area) => ({
                      value: area.id,
                      label: area.name,
                    })),
                  ]}
                  variant="field"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="positionId">Puesto (opcional)</Label>
                <FormSelect
                  defaultValue={defaultValues.positionId}
                  id="positionId"
                  name="positionId"
                  options={[
                    { value: "", label: "Sin puesto" },
                    ...activePositions.map((position) => ({
                      value: position.id,
                      label: position.name,
                    })),
                  ]}
                  variant="field"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="managerId">Jefe directo (opcional)</Label>
                <ManagerPicker
                  excludeId={person?.id}
                  id="managerId"
                  initial={initialManager}
                  name="managerId"
                />
              </div>
            </div>
          </FormSection>

          <FormSection id="horario">
            <ScheduleBlocksEditor
              error={fieldError("horarioBloques")}
              initial={scheduleBlocksOf(schedule)}
            />
          </FormSection>

          <FormSection id="identificadores">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rfc">RFC (opcional)</Label>
                <Input
                  aria-invalid={Boolean(fieldError("rfc"))}
                  defaultValue={defaultValues.rfc}
                  id="rfc"
                  name="rfc"
                  placeholder="XAXX010101000"
                />
                {errorText("rfc")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="curp">CURP (opcional)</Label>
                <Input
                  aria-invalid={Boolean(fieldError("curp"))}
                  defaultValue={defaultValues.curp}
                  id="curp"
                  name="curp"
                  placeholder="XAXX010101HDFXXX00"
                />
                {errorText("curp")}
              </div>
              <div className="space-y-2">
                <Label htmlFor="nss">NSS (opcional)</Label>
                <Input
                  aria-invalid={Boolean(fieldError("nss"))}
                  defaultValue={defaultValues.nss}
                  id="nss"
                  name="nss"
                  placeholder="00000000000"
                />
                {errorText("nss")}
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
                  aria-invalid={Boolean(fieldError("email"))}
                  defaultValue={defaultValues.email}
                  id="email"
                  name="email"
                  placeholder="persona.demo@ejemplo.local"
                  type="email"
                />
                {errorText("email")}
              </div>
            </div>
          </FormSection>

          <FormSection data-testid="datos-mexico" id="datos-mexico">
            <div className="grid gap-4 sm:grid-cols-6">
              <div className="space-y-2 sm:col-span-4">
                <Label htmlFor="domicilioCalle">Calle (opcional)</Label>
                <Input
                  defaultValue={defaultValues.domicilioCalle}
                  id="domicilioCalle"
                  name="domicilioCalle"
                />
              </div>
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="domicilioNumeroExterior">
                  Núm. ext. (opcional)
                </Label>
                <Input
                  defaultValue={defaultValues.domicilioNumeroExterior}
                  id="domicilioNumeroExterior"
                  name="domicilioNumeroExterior"
                />
              </div>
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="domicilioNumeroInterior">
                  Núm. int. (opcional)
                </Label>
                <Input
                  defaultValue={defaultValues.domicilioNumeroInterior}
                  id="domicilioNumeroInterior"
                  name="domicilioNumeroInterior"
                />
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="domicilioColonia">Colonia (opcional)</Label>
                <Input
                  defaultValue={defaultValues.domicilioColonia}
                  id="domicilioColonia"
                  name="domicilioColonia"
                />
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="domicilioMunicipio">
                  Municipio o alcaldía (opcional)
                </Label>
                <Input
                  defaultValue={defaultValues.domicilioMunicipio}
                  id="domicilioMunicipio"
                  name="domicilioMunicipio"
                />
              </div>
              <div className="space-y-2 sm:col-span-4">
                <Label htmlFor="domicilioEstado">Estado (opcional)</Label>
                <FormSelect
                  defaultValue={defaultValues.domicilioEstado}
                  id="domicilioEstado"
                  name="domicilioEstado"
                  options={stateOptions("Sin estado")}
                  variant="field"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="domicilioCodigoPostal">
                  Código postal (opcional)
                </Label>
                <Input
                  aria-invalid={Boolean(fieldError("domicilioCodigoPostal"))}
                  defaultValue={defaultValues.domicilioCodigoPostal}
                  id="domicilioCodigoPostal"
                  inputMode="numeric"
                  maxLength={5}
                  name="domicilioCodigoPostal"
                  placeholder="29000"
                />
                {errorText("domicilioCodigoPostal")}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="estadoCivil">Estado civil (opcional)</Label>
                <FormSelect
                  defaultValue={defaultValues.estadoCivil}
                  id="estadoCivil"
                  name="estadoCivil"
                  options={[
                    { value: "", label: "Sin capturar" },
                    ...MARITAL_STATUSES.map((value) => ({
                      value,
                      label: maritalStatusLabels[value],
                    })),
                  ]}
                  variant="field"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="sexo">Sexo (opcional)</Label>
                <FormSelect
                  defaultValue={defaultValues.sexo}
                  id="sexo"
                  name="sexo"
                  options={[
                    { value: "", label: "Sin capturar" },
                    ...SEXES.map((value) => ({
                      value,
                      label: sexLabels[value],
                    })),
                  ]}
                  variant="field"
                />
                <p className="text-muted-foreground text-xs">
                  Como aparece en la CURP.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="nacionalidad">Nacionalidad (opcional)</Label>
                <Input
                  defaultValue={defaultValues.nacionalidad}
                  id="nacionalidad"
                  name="nacionalidad"
                />
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="lugarNacimiento">
                  Lugar de nacimiento (opcional)
                </Label>
                <FormSelect
                  defaultValue={defaultValues.lugarNacimiento}
                  id="lugarNacimiento"
                  name="lugarNacimiento"
                  options={stateOptions("Sin capturar")}
                  variant="field"
                />
              </div>
              <div className="space-y-2 sm:col-span-3">
                <Label htmlFor="ineClaveElector">
                  Clave de elector (INE) (opcional)
                </Label>
                <Input
                  aria-invalid={Boolean(fieldError("ineClaveElector"))}
                  defaultValue={defaultValues.ineClaveElector}
                  id="ineClaveElector"
                  maxLength={18}
                  name="ineClaveElector"
                  placeholder="18 letras y números"
                />
                {errorText("ineClaveElector")}
              </div>
            </div>
          </FormSection>

          <FormSection id="beneficiarios">
            <BeneficiariesEditor
              error={fieldError("beneficiarios")}
              initial={beneficiaries}
            />
          </FormSection>
        </div>
      </div>

      <div className="bg-background/95 supports-backdrop-filter:bg-background/80 sticky -bottom-4 z-10 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t px-4 py-3 backdrop-blur md:-bottom-6 md:-mx-6 md:-mb-6 md:px-6">
        <p
          aria-live="polite"
          className={cn(
            "basis-full text-sm sm:mr-auto sm:basis-auto",
            pending > 0 ? "text-foreground" : "text-muted-foreground",
          )}
          data-testid="pendientes-obligatorios"
        >
          {pendingLabel(pending)}
        </p>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
        <SubmitButton label="Guardar persona" />
      </div>
    </form>
  );
};
