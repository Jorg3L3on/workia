import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getEmployeeExpediente } from "@/lib/employee/expediente";
import {
  expedienteField,
  expedienteSections,
} from "@/lib/employee/expediente-model";
import { cancelProfileCorrectionAction } from "@/lib/employee/correction-actions";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { formatDateMx, isoToday } from "@/lib/format/date";
import { listOwnProfileCorrections } from "@/lib/profile-corrections";
import { PROFILE_CORRECTION_STATUS_LABELS } from "@/lib/profile-corrections/labels";
import { toneFor } from "@/lib/ui/status-tone";

export const metadata: Metadata = { title: "Mi expediente" };

export const dynamic = "force-dynamic";

type MiExpedientePageProps = {
  searchParams: Promise<{ enviada?: string }>;
};

/**
 * Mi expediente (Workia 2.0 W2-02): the employee's own record, read only.
 * Every value comes from a column listed in EXPEDIENTE_FIELDS; «Corregir»
 * sends HR the proposed change instead of editing it. The person is the
 * session's; the route takes no id.
 */
const MiExpedientePage = async ({ searchParams }: MiExpedientePageProps) => {
  const context = await requireEmployeeContext();
  const [expediente, corrections, { enviada }] = await Promise.all([
    getEmployeeExpediente(context),
    listOwnProfileCorrections(context),
    searchParams,
  ]);

  if (!expediente) {
    notFound();
  }

  const sections = expedienteSections(expediente, isoToday());
  const pendingFields = new Set(
    corrections
      .filter((correction) => correction.status === "pendiente")
      .map((correction) => correction.field),
  );

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-4 pb-10">
      <header className="flex items-center gap-2">
        <Button asChild size="lg" variant="ghost">
          <Link href="/mi">
            <ChevronLeftIcon aria-hidden />
            Inicio
          </Link>
        </Button>
      </header>

      <section className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Mi expediente</h1>
        <p className="text-muted-foreground text-sm">
          Lo que RH tiene registrado de ti. Si algo está mal o falta, pide la
          corrección y RH la revisa.
        </p>
      </section>

      {enviada === "1" ? (
        <p
          className="workia-pass-card px-5 py-3 text-sm font-medium"
          role="status"
        >
          Enviamos tu corrección a RH. Aquí verás cuando la revisen.
        </p>
      ) : null}

      {sections.map((section) => (
        <section
          aria-labelledby={`expediente-${section.group}`}
          className="workia-pass-card flex flex-col gap-3 px-5 py-4"
          key={section.group}
        >
          <h2
            className="text-base font-semibold"
            id={`expediente-${section.group}`}
          >
            {section.title}
          </h2>
          <dl className="divide-border flex flex-col divide-y text-sm">
            {section.rows.map((row) => (
              <div
                className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                data-field={row.key}
                key={row.key}
              >
                <div className="min-w-0">
                  <dt className="workia-field-label">{row.label}</dt>
                  <dd
                    className={
                      row.value
                        ? "font-medium break-words"
                        : "text-muted-foreground"
                    }
                  >
                    {row.value ?? "Sin capturar"}
                  </dd>
                </div>
                {row.correctable ? (
                  pendingFields.has(row.key) ? (
                    <Badge className="mt-1 shrink-0" tone="warning">
                      En revisión
                    </Badge>
                  ) : (
                    <Button
                      asChild
                      className="shrink-0"
                      size="sm"
                      variant="secondary"
                    >
                      <Link
                        aria-label={`Corregir ${row.label}`}
                        href={`/mi/expediente/corregir?campo=${row.key}`}
                      >
                        Corregir
                      </Link>
                    </Button>
                  )
                ) : null}
              </div>
            ))}
          </dl>
        </section>
      ))}

      <section
        aria-labelledby="mis-correcciones"
        className="workia-pass-card flex flex-col gap-3 px-5 py-4"
      >
        <h2 className="text-base font-semibold" id="mis-correcciones">
          Mis correcciones
        </h2>
        {corrections.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No has pedido correcciones.
          </p>
        ) : (
          <ul className="divide-border flex flex-col divide-y text-sm">
            {corrections.map((correction) => (
              <li
                className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0"
                data-correction={correction.field}
                key={correction.id}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {expedienteField(correction.field)?.label ??
                      correction.field}
                  </span>
                  <Badge tone={toneFor("correction", correction.status)}>
                    {PROFILE_CORRECTION_STATUS_LABELS[correction.status]}
                  </Badge>
                </div>
                <p className="text-muted-foreground break-words">
                  {correction.currentValue ?? "Sin capturar"} →{" "}
                  <span className="text-foreground">
                    {correction.proposedValue}
                  </span>
                </p>
                <p className="text-muted-foreground text-xs">
                  Enviada el {formatDateMx(correction.createdAt)}
                  {correction.decidedAt && correction.status !== "pendiente"
                    ? ` · revisada el ${formatDateMx(correction.decidedAt)}`
                    : ""}
                </p>
                {correction.status === "rechazada" &&
                correction.decisionReason ? (
                  <p className="break-words">
                    <span className="font-medium">Motivo de RH:</span>{" "}
                    {correction.decisionReason}
                  </p>
                ) : null}
                {correction.status === "pendiente" ? (
                  <form action={cancelProfileCorrectionAction}>
                    <input name="id" type="hidden" value={correction.id} />
                    <Button size="sm" type="submit" variant="ghost">
                      Cancelar solicitud
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};

export default MiExpedientePage;
