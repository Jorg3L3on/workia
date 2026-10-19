import Link from "next/link";
import { CalendarClockIcon, LaptopIcon, UserPlusIcon } from "lucide-react";

import { ListPageHeader } from "@/components/list/list-page-header";
import { ListEmptyState } from "@/components/list/list-table-shell";
import { CountUp } from "@/components/motion/count-up";
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
        <Badge
          tone={pendingCount === 0 ? "success" : urgent ? "warning" : "info"}
        >
          {pendingCount} pendiente{pendingCount === 1 ? "" : "s"}
        </Badge>
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
  const contractPendingCount = canReadContracts ? urgentCount : 0;

  return (
    <div className="flex flex-col gap-6">
      <ListPageHeader
        actions={
          isCalm ? (
            <Badge tone="success">Nada urgente hoy</Badge>
          ) : (
            <Badge tone="danger">
              {urgentCount} urgente{urgentCount === 1 ? "" : "s"}
            </Badge>
          )
        }
        description="Vencimientos de contrato y resguardo de equipo aparecen aquí cuando requieren tu atención."
        title="Qué hay que atender hoy"
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
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
          <Button asChild size="sm" variant="secondary">
            <Link href="/app/personas/nueva">
              <UserPlusIcon className="size-4" aria-hidden />
              Dar de alta
            </Link>
          </Button>
        ) : canReadPeople ? (
          <Button asChild size="sm" variant="secondary">
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
            <ul className="divide-y">
              {renewalItems.map((item) => (
                <li
                  key={item.contract.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm first:pt-0"
                >
                  <div>
                    <p className="font-medium">{item.personName}</p>
                    <p className="text-muted-foreground text-xs">
                      Vence {formatContractDate(item.endDate)} ·{" "}
                      {contractNoticeWindowLabels[item.noticeWindow]}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/app/contratos">Atender</Link>
                  </Button>
                </li>
              ))}
              {urgentCount > renewalItems.length ? (
                <Button
                  asChild
                  className="mt-2 w-full"
                  size="sm"
                  variant="ghost"
                >
                  <Link href="/app/contratos">
                    Ver {urgentCount - renewalItems.length} más en Contratos
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
