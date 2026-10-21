import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import type { KeyFact } from "@/components/people/person-detail-model";
import { cn } from "@/lib/utils";

type PersonCredentialProps = {
  initials: string;
  status: "activa" | "baja";
  /** A soft-deleted expediente reads like a baja: grey badge. */
  isDeleted?: boolean;
  /** The PageHeader: name, status badges, puesto · área · sucursal, actions. */
  header: ReactNode;
  facts: KeyFact[];
};

const urgencyClass: Partial<Record<NonNullable<KeyFact["urgency"]>, string>> = {
  proximo: "text-amber-700 dark:text-amber-300",
  vencido: "text-destructive",
};

/** The strip of key facts under the badge: antigüedad, ingreso, contrato, jefe, horario. */
export const PersonKeyFacts = ({ facts }: { facts: KeyFact[] }) => (
  <dl
    className="workia-credential-facts grid grid-cols-2 md:grid-cols-[repeat(var(--facts),minmax(0,1fr))]"
    data-testid="person-key-facts"
    style={{ "--facts": facts.length } as CSSProperties}
  >
    {facts.map((fact) => (
      <div
        className="workia-credential-fact min-w-0 px-5 py-3 sm:px-6 max-md:[&:last-child:nth-child(odd)]:col-span-2"
        data-fact={fact.id}
        key={fact.id}
      >
        <dt className="workia-field-label">{fact.label}</dt>
        <dd className="mt-0.5 text-sm font-medium break-words">
          {fact.href ? (
            <Link className="hover:underline" href={fact.href}>
              {fact.value}
            </Link>
          ) : (
            fact.value
          )}
        </dd>
        {fact.hint ? (
          <dd
            className={cn(
              "text-muted-foreground text-xs",
              fact.urgency && urgencyClass[fact.urgency],
            )}
          >
            {fact.hint}
          </dd>
        ) : null}
      </div>
    ))}
  </dl>
);

/**
 * The expediente's badge (gafete): avatar with initials, the page header and
 * the key facts. A person on baja (or a deleted expediente) gets the grey
 * badge. No employee number (not in the model), no QR, no barcode.
 */
export const PersonCredential = ({
  initials,
  status,
  isDeleted = false,
  header,
  facts,
}: PersonCredentialProps) => (
  <section
    aria-label="Credencial"
    className="workia-pass-card workia-credential"
    data-status={isDeleted ? "borrado" : status}
    data-testid="person-credential"
  >
    <div className="flex items-start gap-4 p-5 sm:gap-5 sm:p-6">
      <div
        aria-hidden
        className="workia-credential-avatar size-12 text-lg sm:size-16 sm:text-2xl"
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="workia-field-label">Expediente</p>
        {header}
      </div>
    </div>
    {facts.length > 0 ? <PersonKeyFacts facts={facts} /> : null}
  </section>
);
