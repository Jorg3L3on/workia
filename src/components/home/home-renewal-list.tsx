"use client";

import Link from "next/link";
import { useState } from "react";

import { RenewalDecisionDialog } from "@/components/contracts/renewal-decision-dialog";
import { Badge } from "@/components/ui/badge";
import type { RenewalTrayItem } from "@/lib/contracts";
import { formatContractDate, renewalStatus } from "@/lib/contracts/schema";
import type { ContractTemplate } from "@/lib/db/schema";
import { toneFor } from "@/lib/ui/status-tone";

type HomeRenewalListProps = {
  items: RenewalTrayItem[];
  /** Empty when the user may not renew: rows then link to Contratos. */
  templates: ContractTemplate[];
  positions: { id: string; name: string }[];
  canSeeCompensation: boolean;
  today: string;
};

const rowClassName =
  "hover:bg-muted/60 focus-visible:ring-ring -mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left text-sm outline-none focus-visible:ring-2";

/** Contratos por vencer on Inicio: the row opens «Decidir renovación». */
export const HomeRenewalList = ({
  items,
  templates,
  positions,
  canSeeCompensation,
  today,
}: HomeRenewalListProps) => {
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const deciding = items.find((item) => item.contract.id === decidingId);
  const canDecide = templates.length > 0;

  return (
    <>
      <ul className="divide-y">
        {items.map((item) => {
          const status = renewalStatus(item.endDate, today);
          const content = (
            <>
              <span className="min-w-0">
                <span className="block truncate">{item.personName}</span>
                <span className="text-muted-foreground block text-xs tabular-nums">
                  Vence {formatContractDate(item.endDate)}
                </span>
              </span>
              <Badge tone={toneFor("renewal", status.urgency)}>
                {status.label}
              </Badge>
            </>
          );

          return (
            <li key={item.contract.id}>
              {canDecide ? (
                <button
                  aria-label={`Decidir renovación de ${item.personName}`}
                  className={rowClassName}
                  onClick={() => setDecidingId(item.contract.id)}
                  type="button"
                >
                  {content}
                </button>
              ) : (
                <Link className={rowClassName} href="/app/contratos">
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {deciding ? (
        <RenewalDecisionDialog
          canSeeCompensation={canSeeCompensation}
          compensation={deciding.compensation}
          contractId={deciding.contract.id}
          endDate={deciding.endDate}
          key={deciding.contract.id}
          onOpenChange={(open) => {
            if (!open) setDecidingId(null);
          }}
          open
          personName={deciding.personName}
          positions={positions}
          templates={templates}
        />
      ) : null}
    </>
  );
};
