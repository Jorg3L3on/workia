import type { EmploymentPeriodItem } from "@/components/people/person-detail-model";

/** «Periodos laborales» of the Laboral card: ingreso → baja, tipo, motivo, finiquito. */
export const PersonEmploymentPeriods = ({
  items,
}: {
  items: EmploymentPeriodItem[];
}) => (
  <ol className="space-y-2" data-testid="employment-periods">
    {items.map((item) => (
      <li className="min-w-0" key={item.id}>
        <span className="text-muted-foreground text-xs">{item.label}</span>
        <span className="block">{item.range}</span>
        {item.details.length > 0 ? (
          <span className="text-muted-foreground block text-xs font-normal">
            {item.details.join(" · ")}
          </span>
        ) : null}
      </li>
    ))}
  </ol>
);
