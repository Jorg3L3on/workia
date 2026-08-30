import {
  CalendarClockIcon,
  CheckCircle2Icon,
  FolderTreeIcon,
  HomeIcon,
  LaptopIcon,
  ScrollTextIcon,
  UsersIcon,
} from "lucide-react";

import { WorkiaMark } from "@/components/brand/workia-mark";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { title: "Inicio", icon: HomeIcon, active: true },
  { title: "Personas", icon: UsersIcon, active: false },
  { title: "Catálogo", icon: FolderTreeIcon, active: false },
  { title: "Auditoría", icon: ScrollTextIcon, active: false },
] as const;

/** Static product mock — obviously fake demo data only. */
export const LandingAppMock = () => {
  return (
    <div
      aria-hidden
      className="workia-pass-card pointer-events-none mx-auto w-full max-w-5xl overflow-hidden select-none"
    >
      <div className="workia-credential-header flex items-center gap-3 px-4 py-3">
        <WorkiaMark className="h-7" />
        <div className="workia-credential-slot" />
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <span className="text-muted-foreground font-mono text-[10px] tracking-[0.08em] uppercase">
            Corporativo Demo
          </span>
          <div className="bg-muted flex size-7 items-center justify-center rounded-full text-xs font-medium">
            PD
          </div>
        </div>
      </div>

      <div className="flex">
        <aside className="border-border hidden w-44 shrink-0 border-r bg-[color-mix(in_srgb,var(--workia-badge-a)_80%,transparent)] p-3 md:block">
          <p className="text-muted-foreground mb-2 px-2 font-mono text-[9px] tracking-[0.1em] uppercase">
            Navegación
          </p>
          <nav className="space-y-0.5">
            {navItems.map(({ title, icon: Icon, active }) => (
              <div
                key={title}
                className="workia-nav-link flex items-center gap-2"
                data-active={active ? "true" : "false"}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {title}
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <header className="mb-4 space-y-2">
            <p className="text-muted-foreground font-mono text-[10px] font-medium tracking-[0.09em] uppercase">
              Tu credencial de acceso
            </p>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-lg font-semibold tracking-tight sm:text-xl">
                Qué hay que atender hoy
              </h3>
              <Badge
                className="workia-accent-gradient shrink-0 border-0 text-white"
                variant="outline"
              >
                <CheckCircle2Icon className="size-3" aria-hidden />
                Nada urgente hoy
              </Badge>
            </div>
          </header>

          <div className="workia-pass-card mb-4 flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <p className="text-sm">
              <span className="workia-accent-text font-semibold">12</span>
              <span className="text-muted-foreground">
                {" "}
                personas con relación activa en el expediente
              </span>
            </p>
            <span className="text-muted-foreground rounded-md border px-2 py-1 text-xs">
              Sucursal Demo · CDMX
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="workia-pass-card space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CalendarClockIcon
                    className="text-muted-foreground size-4"
                    aria-hidden
                  />
                  <p className="text-sm font-medium">Contratos por vencer</p>
                </div>
                <Badge variant="secondary">0 pendientes</Badge>
              </div>
              <div className="workia-empty-state px-3 py-4 text-center">
                <p className="text-sm font-medium">
                  Sin vencimientos por ahora
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Próximamente: avisos configurables por contrato
                </p>
              </div>
            </div>

            <div className="workia-pass-card space-y-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <LaptopIcon
                    className="text-muted-foreground size-4"
                    aria-hidden
                  />
                  <p className="text-sm font-medium">Equipo pendiente</p>
                </div>
                <Badge variant="secondary">0 pendientes</Badge>
              </div>
              <div className="workia-empty-state px-3 py-4 text-center">
                <p className="text-sm font-medium">Sin equipo pendiente</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  Entregas y devoluciones visibles en Resguardo
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-dashed px-3 py-2">
            <p className="text-muted-foreground text-xs">
              <span className="text-foreground font-medium">Persona Demo</span>
              {" · "}
              Área Operaciones Demo · Alta registrada en auditoría
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
