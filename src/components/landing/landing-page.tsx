import Link from "next/link";
import {
  ArrowRightIcon,
  Building2Icon,
  CalendarClockIcon,
  FolderTreeIcon,
  LaptopIcon,
  ScrollTextIcon,
  UsersIcon,
} from "lucide-react";

import { LandingAppMock } from "@/components/landing/landing-app-mock";
import { WorkiaMark } from "@/components/brand/workia-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type LandingStep = {
  number: string;
  title: string;
  description: string;
  icon: typeof UsersIcon;
  upcoming?: boolean;
};

const steps: LandingStep[] = [
  {
    number: "01",
    title: "Expediente centralizado",
    description:
      "Personas, áreas y sucursales en un solo lugar — sin cazar datos en Excel ni correos.",
    icon: UsersIcon,
  },
  {
    number: "02",
    title: "Contratos con aviso configurable",
    description:
      "Los vencimientos se ven a tiempo, con recordatorios antes de que se escape la renovación.",
    icon: CalendarClockIcon,
    upcoming: true,
  },
  {
    number: "03",
    title: "Resguardo de lo que importa",
    description:
      "El equipo caro tiene dueño e historial: entregas, devoluciones y trazabilidad clara.",
    icon: LaptopIcon,
    upcoming: true,
  },
];

const liveCapabilities = [
  {
    title: "Expediente de personas",
    description:
      "Altas, relaciones laborales y datos clave de RRHH en México — RFC, CURP, NSS y más.",
    icon: UsersIcon,
  },
  {
    title: "Árbol de áreas",
    description:
      "Organiza departamentos y puestos con un catálogo jerárquico que el equipo entiende.",
    icon: FolderTreeIcon,
  },
  {
    title: "Sucursal y corporativo",
    description:
      "Opera por sitio o vista corporativa: cada sucursal con su contexto, un solo expediente.",
    icon: Building2Icon,
  },
  {
    title: "Auditoría",
    description:
      "Quién cambió qué y cuándo — eventos inmutables para cumplimiento y confianza.",
    icon: ScrollTextIcon,
  },
] as const;

const upcomingCapabilities = [
  {
    title: "Contratos",
    description:
      "Vencimientos, renovaciones y avisos configurables por contrato.",
    icon: CalendarClockIcon,
  },
  {
    title: "Resguardo",
    description:
      "Equipo asignado con dueño, entregas y devoluciones rastreadas.",
    icon: LaptopIcon,
  },
] as const;

const painPoints = [
  "Fechas de contrato repartidas en Excel y carpetas compartidas",
  "Resguardos de equipo sin dueño claro ni historial",
  "Correos y documentos sueltos que nadie encuentra a tiempo",
  "RRHH persiguiendo información en lugar de atender personas",
] as const;

const LandingCta = ({
  className,
  size = "lg",
}: {
  className?: string;
  size?: "default" | "lg";
}) => (
  <Button asChild className={className} size={size} variant="default">
    <Link href="/login">
      Entrar
      <ArrowRightIcon aria-hidden />
    </Link>
  </Button>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
    {children}
  </p>
);

export const LandingPage = () => {
  return (
    <div className="workia-shell relative min-h-svh overflow-x-hidden">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div
          className="login-ambient-blob"
          style={{
            width: 480,
            height: 480,
            background: "var(--workia-accent-blue)",
            top: -180,
            left: -140,
          }}
        />
        <div
          className="login-ambient-blob login-ambient-blob-b"
          style={{
            width: 420,
            height: 420,
            background: "var(--workia-accent-violet)",
            bottom: -120,
            right: -80,
          }}
        />
      </div>
      <div className="workia-shell-grain absolute inset-0" aria-hidden />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <Link
          aria-label="workia — inicio"
          className="flex items-center gap-2.5"
          href="/"
        >
          <WorkiaMark />
          <span className="text-lg font-semibold tracking-tight">workia</span>
        </Link>
        <LandingCta size="default" />
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-20 px-5 pb-20 sm:px-8 sm:pb-28">
        {/* Hero */}
        <section className="flex flex-col items-center gap-8 pt-4 text-center sm:pt-8">
          <Badge
            className="border-0 bg-[color-mix(in_srgb,var(--workia-badge-a)_90%,transparent)] px-3 py-1 font-mono text-[10px] tracking-[0.08em] uppercase"
            variant="secondary"
          >
            RRHH · México
          </Badge>
          <div className="max-w-3xl space-y-4">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
              RRHH deja de cazar fechas en{" "}
              <span className="workia-accent-text">Excel y correos</span>
            </h1>
            <p className="text-muted-foreground mx-auto max-w-2xl text-base sm:text-lg">
              El expediente vive en Workia. Los contratos que vencen se ven a
              tiempo. El equipo caro tiene dueño e historial.
            </p>
          </div>
          <LandingCta className="login-stamp-btn h-10 px-6 text-base" />
        </section>

        {/* El problema */}
        <section aria-labelledby="problema-heading" className="space-y-6">
          <div className="space-y-2 text-center">
            <SectionLabel>El problema</SectionLabel>
            <h2
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
              id="problema-heading"
            >
              La operación ya existe. La fuente de verdad, no.
            </h2>
            <p className="text-muted-foreground mx-auto max-w-2xl text-sm sm:text-base">
              Expedientes repartidos, contratos que se escapan y equipo sin
              historial — RRHH pierde tiempo buscando en lugar de decidir.
            </p>
          </div>
          <ul className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-2">
            {painPoints.map((point) => (
              <li
                key={point}
                className="workia-pass-card px-4 py-3 text-sm leading-relaxed"
              >
                {point}
              </li>
            ))}
          </ul>
        </section>

        {/* Cómo funciona */}
        <section aria-labelledby="como-funciona-heading" className="space-y-8">
          <div className="space-y-2 text-center">
            <SectionLabel>Cómo funciona</SectionLabel>
            <h2
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
              id="como-funciona-heading"
            >
              Tres pasos. Un expediente que responde.
            </h2>
          </div>
          <ol className="grid gap-4 md:grid-cols-3">
            {steps.map(
              ({ number, title, description, icon: Icon, upcoming }) => (
                <li
                  key={number}
                  className="workia-pass-card flex flex-col gap-4 p-5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="workia-accent-text font-mono text-sm font-semibold">
                      {number}
                    </span>
                    {upcoming ? (
                      <Badge className="shrink-0 text-[10px]" variant="outline">
                        Lo que viene
                      </Badge>
                    ) : null}
                  </div>
                  <Icon className="text-muted-foreground size-5" aria-hidden />
                  <div className="space-y-2">
                    <h3 className="font-semibold tracking-tight">{title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {description}
                    </p>
                  </div>
                </li>
              ),
            )}
          </ol>
        </section>

        {/* Product mock */}
        <section aria-labelledby="producto-heading" className="space-y-8">
          <div className="space-y-2 text-center">
            <SectionLabel>El producto</SectionLabel>
            <h2
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
              id="producto-heading"
            >
              Qué hay que atender hoy — sin abrir Excel
            </h2>
            <p className="text-muted-foreground mx-auto max-w-2xl text-sm sm:text-base">
              La misma credencial que usas al entrar: inicio con lo urgente,
              expediente a un clic y trazabilidad cuando la necesitas.
            </p>
          </div>
          <LandingAppMock />
        </section>

        {/* Capacidades */}
        <section aria-labelledby="capacidades-heading" className="space-y-8">
          <div className="space-y-2 text-center">
            <SectionLabel>Capacidades</SectionLabel>
            <h2
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
              id="capacidades-heading"
            >
              Lo que ya puedes operar hoy
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {liveCapabilities.map(({ title, description, icon: Icon }) => (
              <article key={title} className="workia-pass-card flex gap-4 p-5">
                <Icon
                  className="text-muted-foreground mt-0.5 size-5 shrink-0"
                  aria-hidden
                />
                <div className="space-y-1.5">
                  <h3 className="font-semibold tracking-tight">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {description}
                  </p>
                </div>
              </article>
            ))}
          </div>

          <div className="space-y-4">
            <p className="text-muted-foreground text-center text-sm">
              En el roadmap — no disponible en producción todavía
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {upcomingCapabilities.map(
                ({ title, description, icon: Icon }) => (
                  <article
                    key={title}
                    className="workia-empty-state flex gap-4 p-5"
                  >
                    <Icon
                      className="text-muted-foreground mt-0.5 size-5 shrink-0"
                      aria-hidden
                    />
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold tracking-tight">
                          {title}
                        </h3>
                        <Badge className="text-[10px]" variant="outline">
                          Lo que viene
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        {description}
                      </p>
                    </div>
                  </article>
                ),
              )}
            </div>
          </div>
        </section>

        {/* Close CTA */}
        <section
          aria-labelledby="cta-heading"
          className="workia-pass-card flex flex-col items-center gap-6 px-6 py-10 text-center sm:px-10 sm:py-12"
        >
          <div className="space-y-3">
            <h2
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
              id="cta-heading"
            >
              Entra y revisa el expediente
            </h2>
            <p className="text-muted-foreground max-w-lg text-sm sm:text-base">
              Sin precios en esta página — solo acceso. Inicia sesión y opera
              con datos de demo en tu entorno.
            </p>
          </div>
          <LandingCta className="login-stamp-btn h-10 px-6 text-base" />
        </section>
      </main>

      <footer className="relative z-10 border-t px-5 py-6 text-center sm:px-8">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.04em]">
          Hecho para{" "}
          <strong className="font-semibold text-[color:var(--workia-ink-muted)]">
            RRHH
          </strong>
          {" · "}
          workia
        </p>
      </footer>
    </div>
  );
};
