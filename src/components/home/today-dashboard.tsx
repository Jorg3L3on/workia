import Link from "next/link";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  LaptopIcon,
  UserPlusIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RenewalTrayItem } from "@/lib/contracts";
import {
  contractNoticeWindowLabels,
  formatContractDate,
} from "@/lib/contracts/schema";

export type TodayDashboardProps = {
  activePeopleCount: number;
  urgentCount: number;
  canManagePeople: boolean;
  canReadPeople: boolean;
  canReadContracts: boolean;
  renewalItems: RenewalTrayItem[];
};

type AttentionSectionProps = {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  icon: React.ComponentType<{ className?: string }>;
  pendingCount: number;
  urgent?: boolean;
  children?: React.ReactNode;
};

const AttentionSection = ({
  title,
  description,
  emptyTitle,
  emptyDescription,
  icon: Icon,
  pendingCount,
  urgent = false,
  children,
}: AttentionSectionProps) => {
  return (
    <section
      className={`workia-pass-card flex flex-col gap-4 p-5 ${urgent ? "workia-pass-card-urgent" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Icon
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          </div>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <Badge className="shrink-0" variant="secondary">
          {pendingCount} pendiente{pendingCount === 1 ? "" : "s"}
        </Badge>
      </div>

      {pendingCount === 0 ? (
        <div className="workia-empty-state px-4 py-5 text-center">
          <p className="text-sm font-medium">{emptyTitle}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {emptyDescription}
          </p>
        </div>
      ) : (
        children
      )}
    </section>
  );
};

export const TodayDashboard = ({
  activePeopleCount,
  urgentCount,
  canManagePeople,
  canReadPeople,
  canReadContracts,
  renewalItems,
}: TodayDashboardProps) => {
  const isCalm = urgentCount === 0;
  const contractPendingCount = canReadContracts ? renewalItems.length : 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
              Tu credencial de acceso
            </p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Qué hay que atender hoy
            </h1>
            <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
              Vencimientos de contrato y resguardo de equipo aparecerán aquí
              cuando requieran tu atención.
            </p>
          </div>
          {isCalm ? (
            <Badge
              className="workia-accent-gradient shrink-0 border-0 text-white"
              variant="outline"
            >
              <CheckCircle2Icon className="size-3.5" aria-hidden />
              Nada urgente hoy
            </Badge>
          ) : (
            <Badge className="workia-accent-gradient shrink-0 border-0 text-white">
              {urgentCount} urgente{urgentCount === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        <div className="workia-pass-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          {canReadPeople ? (
            <p className="text-sm">
              <span className="workia-accent-text font-semibold">
                {activePeopleCount}
              </span>
              <span className="text-muted-foreground">
                {" "}
                persona{activePeopleCount === 1 ? "" : "s"} con relación activa
                en el expediente
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              Tu rol no incluye acceso al expediente de personas.
            </p>
          )}
          {canManagePeople ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/app/personas/nueva">
                <UserPlusIcon className="size-4" aria-hidden />
                Dar de alta
              </Link>
            </Button>
          ) : canReadPeople ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/app/personas">Ver personas</Link>
            </Button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <AttentionSection
          description="Contratos que vencen pronto — listos para la bandeja de renovaciones."
          emptyDescription="No hay contratos en ventana de aviso según su configuración."
          emptyTitle="Sin vencimientos por ahora"
          icon={CalendarClockIcon}
          pendingCount={contractPendingCount}
          title="Contratos por vencer"
          urgent={contractPendingCount > 0}
        >
          {canReadContracts ? (
            <ul className="space-y-2">
              {renewalItems.slice(0, 5).map((item) => (
                <li
                  key={item.contract.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{item.personName}</p>
                    <p className="text-muted-foreground text-xs">
                      Vence {formatContractDate(item.endDate)} ·{" "}
                      {contractNoticeWindowLabels[item.noticeWindow]}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/app/contratos">Atender</Link>
                  </Button>
                </li>
              ))}
              {renewalItems.length > 5 ? (
                <Button asChild className="w-full" size="sm" variant="ghost">
                  <Link href="/app/contratos">
                    Ver {renewalItems.length - 5} más en Contratos
                  </Link>
                </Button>
              ) : null}
            </ul>
          ) : null}
        </AttentionSection>
        <AttentionSection
          description="Entregas o devoluciones de equipo sin cerrar — listas para resguardo."
          emptyDescription="Cuando exista resguardo de equipo, verás aquí lo pendiente de entregar o recibir."
          emptyTitle="Sin equipo pendiente"
          icon={LaptopIcon}
          pendingCount={0}
          title="Equipo pendiente"
        />
      </div>
    </div>
  );
};
