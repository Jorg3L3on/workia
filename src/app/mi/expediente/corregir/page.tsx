import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon } from "lucide-react";

import { CorrectionForm } from "@/components/employee/correction-form";
import { Button } from "@/components/ui/button";
import { getEmployeeExpediente } from "@/lib/employee/expediente";
import {
  correctableField,
  expedienteValues,
  type ExpedienteFieldKey,
} from "@/lib/employee/expediente-model";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { isoToday } from "@/lib/format/date";

export const metadata: Metadata = { title: "Pedir corrección" };

export const dynamic = "force-dynamic";

type CorregirPageProps = {
  searchParams: Promise<{ campo?: string }>;
};

/**
 * One correction request (Workia 2.0 W2-02): the field's value today and
 * what it should say. The field comes from the URL but is checked against
 * EXPEDIENTE_FIELDS; the person is always the session's.
 */
const CorregirPage = async ({ searchParams }: CorregirPageProps) => {
  const context = await requireEmployeeContext();
  const { campo } = await searchParams;
  const field = correctableField(campo);

  if (!field) {
    notFound();
  }

  const expediente = await getEmployeeExpediente(context);

  if (!expediente) {
    notFound();
  }

  const current = expedienteValues(expediente, isoToday())[
    field.key as ExpedienteFieldKey
  ];

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-4 pb-10">
      <header className="flex items-center gap-2">
        <Button asChild size="lg" variant="ghost">
          <Link href="/mi/expediente">
            <ChevronLeftIcon aria-hidden />
            Mi expediente
          </Link>
        </Button>
      </header>

      <section className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Corregir {field.label.toLocaleLowerCase("es-MX")}
        </h1>
        <p className="text-muted-foreground text-sm">
          RH revisa tu solicitud y corrige tu expediente. No cambia nada hasta
          que RH la apruebe.
        </p>
      </section>

      <section className="workia-pass-card flex flex-col gap-4 px-5 py-4">
        <div>
          <p className="workia-field-label">Hoy dice</p>
          <p
            className={
              current ? "font-medium break-words" : "text-muted-foreground"
            }
            data-testid="correction-current"
          >
            {current ?? "Sin capturar"}
          </p>
        </div>
        <CorrectionForm
          field={field.key}
          hint={field.hint}
          label={field.label}
        />
      </section>
    </main>
  );
};

export default CorregirPage;
