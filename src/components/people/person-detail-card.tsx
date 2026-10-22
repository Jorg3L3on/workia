import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import {
  DETAIL_CARDS,
  detailCardDomId,
  personEditHref,
  splitDetailFields,
  type DetailCardId,
  type DetailField,
} from "@/components/people/person-detail-model";
import { cn } from "@/lib/utils";

type CardAction = { label: string; href: string };

type DetailCardProps = {
  id: DetailCardId;
  /** Overrides the card's name (DETAIL_CARDS) as its heading. */
  title?: string;
  description?: string;
  /** The one visible action: «Editar», «Ver todo», «Emitir contrato». */
  action?: CardAction | null;
  className?: string;
  children: ReactNode;
};

/**
 * One section of the expediente. A plain card (border, radius, soft shadow):
 * never a colored bar on its side. The id is what the chips scroll to.
 */
export const DetailCard = ({
  id,
  title,
  description,
  action,
  className,
  children,
}: DetailCardProps) => {
  const domId = detailCardDomId(id);
  const heading = title ?? DETAIL_CARDS[id];

  return (
    <section
      aria-labelledby={`${domId}-titulo`}
      className={cn(
        "workia-pass-card workia-detail-card flex min-w-0 flex-col",
        className,
      )}
      data-card={id}
      id={domId}
      tabIndex={-1}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4 sm:px-6">
        <div className="min-w-0 space-y-0.5">
          <h2
            className="text-base font-semibold tracking-tight"
            id={`${domId}-titulo`}
          >
            {heading}
          </h2>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
        {action ? (
          <Link
            className="workia-accent-text -my-1 shrink-0 rounded-md px-1.5 py-1 text-sm font-medium hover:underline"
            href={action.href}
          >
            {action.label} <span className="sr-only">{heading}</span>
          </Link>
        ) : null}
      </div>
      <div className="flex-1 px-5 pt-3 pb-5 sm:px-6">{children}</div>
    </section>
  );
};

type DetailFieldListProps = {
  personId: string;
  fields: DetailField[];
  /** people:update on a live expediente: missing fields link to the form. */
  canEdit: boolean;
};

/** The captured fields, then one «Falta capturar: CURP, NSS» line. */
export const DetailFieldList = ({
  personId,
  fields,
  canEdit,
}: DetailFieldListProps) => {
  const { present, missing } = splitDetailFields(fields);

  return (
    <div className="space-y-3">
      {present.length > 0 ? (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {present.map((field) => (
            <div
              className={cn("min-w-0", field.wide && "sm:col-span-2")}
              data-testid={field.testId}
              key={field.label}
            >
              <dt className="workia-field-label">{field.label}</dt>
              <dd className="font-medium break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {missing.length > 0 ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid="missing-fields"
        >
          <span className="font-medium">Falta capturar:</span>{" "}
          {missing.map((field, index) => (
            <Fragment key={field.label}>
              {index > 0 ? ", " : null}
              {canEdit && field.section ? (
                <Link
                  className="workia-accent-text underline-offset-2 hover:underline"
                  href={personEditHref(personId, field.section, field.field)}
                >
                  {field.label}
                </Link>
              ) : (
                field.label
              )}
            </Fragment>
          ))}
        </p>
      ) : null}
    </div>
  );
};
