import Link from "next/link";
import { ChevronRightIcon, PlusIcon } from "lucide-react";

import { HomeRenewalList } from "@/components/home/home-renewal-list";
import { ListPageHeader } from "@/components/list/list-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { RenewalTrayItem } from "@/lib/contracts";
import type { ContractTemplate } from "@/lib/db/schema";
import { onboardingStageLabels } from "@/lib/onboarding/schema";
import type { AssetToRecover } from "@/lib/resguardo";
import { toneFor } from "@/lib/ui/status-tone";
import { cn } from "@/lib/utils";

type Listed<T> = { total: number; items: T[] };

export type HomeOnboarding = {
  id: string;
  personName: string;
  stage: keyof typeof onboardingStageLabels;
};

/** `null` means the user may not see that module: its tile and list hide. */
export type TodayDashboardProps = {
  activePeopleCount: number | null;
  renewals: Listed<RenewalTrayItem> | null;
  onboardings: Listed<HomeOnboarding> | null;
  assetsToRecover: Listed<AssetToRecover> | null;
  canCreatePeople: boolean;
  canSeeCompensation: boolean;
  /** Empty when the user may not renew. */
  templates: ContractTemplate[];
  positions: { id: string; name: string }[];
  today: string;
};

type KpiTileProps = {
  label: string;
  value: number;
  href: string;
  /** Needs attention: warning border instead of a second badge. */
  attention?: boolean;
};

const KpiTile = ({ label, value, href, attention = false }: KpiTileProps) => (
  <Link
    className={cn(
      "bg-card hover:bg-muted/40 focus-visible:ring-ring flex flex-col gap-1 rounded-lg border p-4 transition-colors outline-none focus-visible:ring-2",
      attention && "border-amber-500/60 dark:border-amber-400/50",
    )}
    data-attention={attention || undefined}
    href={href}
  >
    <span className="text-2xl font-semibold tracking-tight tabular-nums">
      {value}
    </span>
    <span className="text-muted-foreground text-sm">{label}</span>
  </Link>
);

type ListCardProps = {
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
};

const ListCard = ({ title, href, linkLabel, children }: ListCardProps) => (
  <section className="bg-card flex flex-col gap-2 rounded-lg border p-5">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <Link
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-sm"
        href={href}
      >
        {linkLabel}
        <ChevronRightIcon aria-hidden className="size-4" />
      </Link>
    </div>
    {children}
  </section>
);

const EmptyLine = ({ children }: { children: React.ReactNode }) => (
  <p className="text-muted-foreground py-2 text-sm">{children}</p>
);

const moreLine = (total: number, shown: number) =>
  total > shown ? (
    <p className="text-muted-foreground pt-1 text-xs">{total - shown} más</p>
  ) : null;

const rowLinkClassName =
  "hover:bg-muted/60 focus-visible:ring-ring -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 text-sm outline-none focus-visible:ring-2";

export const TodayDashboard = ({
  activePeopleCount,
  renewals,
  onboardings,
  assetsToRecover,
  canCreatePeople,
  canSeeCompensation,
  templates,
  positions,
  today,
}: TodayDashboardProps) => (
  <div className="flex flex-col gap-6">
    <ListPageHeader
      actions={
        canCreatePeople ? (
          <Button asChild>
            <Link href="/app/personas/nueva">
              <PlusIcon aria-hidden />
              Nueva persona
            </Link>
          </Button>
        ) : undefined
      }
      description="Contratos por vencer, altas en proceso y equipo por recuperar."
      title="Qué hay que atender hoy"
    />

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {activePeopleCount !== null ? (
        <KpiTile
          href="/app/personas?status=activa"
          label="Personas activas"
          value={activePeopleCount}
        />
      ) : null}
      {renewals ? (
        <KpiTile
          attention={renewals.total > 0}
          href="/app/contratos"
          label="Contratos por vencer"
          value={renewals.total}
        />
      ) : null}
      {onboardings ? (
        <KpiTile
          href="/app/altas"
          label="Altas en proceso"
          value={onboardings.total}
        />
      ) : null}
      {assetsToRecover ? (
        <KpiTile
          attention={assetsToRecover.total > 0}
          href="/app/resguardo?status=asignado"
          label="Equipo pendiente"
          value={assetsToRecover.total}
        />
      ) : null}
    </div>

    <div className="grid items-start gap-4 lg:grid-cols-2">
      {renewals ? (
        <ListCard
          href="/app/contratos"
          linkLabel="Ver todos"
          title="Contratos por vencer"
        >
          {renewals.items.length === 0 ? (
            <EmptyLine>Ningún contrato en ventana de aviso.</EmptyLine>
          ) : (
            <>
              <HomeRenewalList
                canSeeCompensation={canSeeCompensation}
                items={renewals.items}
                positions={positions}
                templates={templates}
                today={today}
              />
              {moreLine(renewals.total, renewals.items.length)}
            </>
          )}
        </ListCard>
      ) : null}

      {onboardings || assetsToRecover ? (
        <section className="bg-card flex flex-col gap-2 rounded-lg border p-5">
          {onboardings ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold tracking-tight">
                  Altas en proceso
                </h2>
                <Link
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-sm"
                  href="/app/altas"
                >
                  Ver todas
                  <ChevronRightIcon aria-hidden className="size-4" />
                </Link>
              </div>
              {onboardings.items.length === 0 ? (
                <EmptyLine>Ninguna alta en proceso.</EmptyLine>
              ) : (
                <ul className="divide-y">
                  {onboardings.items.map((row) => (
                    <li key={row.id}>
                      <Link
                        className={rowLinkClassName}
                        href={`/app/altas/${row.id}`}
                      >
                        <span className="truncate">{row.personName}</span>
                        <Badge tone={toneFor("onboarding", row.stage)}>
                          {onboardingStageLabels[row.stage]}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {moreLine(onboardings.total, onboardings.items.length)}
            </>
          ) : null}

          {assetsToRecover ? (
            <div
              className={cn(
                "flex flex-col gap-1",
                onboardings && "mt-2 border-t pt-4",
              )}
            >
              <h2 className="text-base font-semibold tracking-tight">
                Equipo pendiente
              </h2>
              {assetsToRecover.items.length === 0 ? (
                <EmptyLine>Nada pendiente de recuperar.</EmptyLine>
              ) : (
                <ul className="divide-y">
                  {assetsToRecover.items.map((asset) => (
                    <li key={asset.id}>
                      <Link
                        className={rowLinkClassName}
                        href={`/app/resguardo/${asset.id}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{asset.name}</span>
                          <span className="text-muted-foreground block text-xs">
                            {asset.identifier}
                          </span>
                        </span>
                        <span className="text-muted-foreground shrink-0 text-xs">
                          Lo tiene {asset.holderName}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {moreLine(assetsToRecover.total, assetsToRecover.items.length)}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  </div>
);
