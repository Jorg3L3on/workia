import Link from "next/link";
import { CalendarClockIcon, LaptopIcon, UserPlusIcon } from "lucide-react";

import { ListPageHeader } from "@/components/list/list-page-header";
import { ListEmptyState } from "@/components/list/list-table-shell";
import { AnimatedBadge } from "@/components/motion/animated-badge";
import { CountUp } from "@/components/motion/count-up";
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
        <AnimatedBadge
          pulse={urgent && pendingCount > 0}
          size="sm"
          status={pendingCount === 0 ? "success" : urgent ? "warning" : "info"}
        >
          {pendingCount} pendiente{pendingCount === 1 ? "" : "s"}
        </AnimatedBadge>
      </div>

      {pendingCount === 0 ? (
        <ListEmptyState
          className="py-6"
          description={emptyDescription}
          title={emptyTitle}
        />
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
      <ListPageHeader
        actions={
          isCalm ? (
            <AnimatedBadge size="sm" status="success">
              Nada urgente hoy
            </AnimatedBadge>
          ) : (
            <AnimatedBadge pulse size="sm" status="danger">
              {urgentCount} urgente{urgentCount === 1 ? "" : "s"}
            </AnimatedBadge>
          )
        }
        description="Vencimientos de contrato y resguardo de equipo aparecen aquí cuando requieren tu atención."
        eyebrow="Hoy"
        title="Qué hay que atender hoy"
      />

      <div className="workia-pass-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        {canReadPeople ? (
          <p className="text-sm">
            <CountUp
              className="text-primary font-semibold tabular-nums"
              value={activePeopleCount}
            />
            <span className="text-muted-foreground">
              {" "}
              persona{activePeopleCount === 1 ? "" : "s"} con relación activa en
              el expediente
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
