"use client";

import { ListMobileCard } from "@/components/list/list-mobile-card";
import { ListRowAction } from "@/components/list/list-row-action";
import { ListStatusBadge } from "@/components/list/list-status-badge";
import type { PersonaListRow } from "@/components/people/persona-list-row";
import { personStatusLabels } from "@/lib/people/schema";

type PersonasMobileListProps = {
  people: PersonaListRow[];
};

export const PersonasMobileList = ({ people }: PersonasMobileListProps) => (
  <div className="flex flex-col gap-3 md:hidden">
    {people.map((person) => (
      <ListMobileCard
        key={person.id}
        actions={
          <ListRowAction
            aria-label={`Ver expediente de ${person.name}`}
            href={`/app/personas/${person.id}`}
          >
            Ver expediente
          </ListRowAction>
        }
        ariaLabel={`Ver expediente de ${person.name}`}
        href={`/app/personas/${person.id}`}
      >
        <div className="space-y-2">
          <p className="truncate font-medium">{person.name}</p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                RFC
              </dt>
              <dd className="mt-0.5 truncate tabular-nums">
                {person.rfc ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                Relación
              </dt>
              <dd className="mt-0.5">
                <ListStatusBadge
                  tone={person.status === "activa" ? "active" : "inactive"}
                >
                  {personStatusLabels[person.status]}
                </ListStatusBadge>
              </dd>
            </div>
          </dl>
        </div>
      </ListMobileCard>
    ))}
  </div>
);
