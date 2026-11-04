import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { formatDateMx } from "@/lib/format/date";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { listEmployeeReceipts } from "@/lib/payroll";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Recibos de nómina" };

/**
 * The employee's nómina receipts (W2-03), newest first, each with its PDF and
 * XML. Everything comes from the session's person; the route takes no id.
 */
const EmployeeReceiptsPage = async () => {
  const context = await requireEmployeeContext();
  const receipts = await listEmployeeReceipts(context);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-6 pb-10">
      <header className="flex items-center justify-between gap-3">
        <Button asChild size="lg" variant="ghost">
          <Link href="/mi">← Inicio</Link>
        </Button>
      </header>

      <section className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Recibos de nómina
        </h1>
        <p className="text-muted-foreground text-sm">
          El CFDI de cada periodo que te pagó tu empresa: el PDF para verlo y el
          XML timbrado.
        </p>
      </section>

      {receipts.length === 0 ? (
        <p className="workia-pass-card text-muted-foreground px-5 py-4 text-sm">
          Aún no hay recibos. Cuando RH publique un periodo, aparece aquí.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Recibos">
          {receipts.map((receipt) => (
            <li
              className="workia-pass-card flex flex-col gap-3 px-5 py-4"
              key={receipt.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{receipt.label}</h2>
                  <p className="text-muted-foreground text-sm">
                    Del {formatDateMx(receipt.periodStart)} al{" "}
                    {formatDateMx(receipt.periodEnd)}
                    {receipt.paymentDate
                      ? ` · pagado el ${formatDateMx(receipt.paymentDate)}`
                      : ""}
                  </p>
                </div>
                {receipt.openedAt ? null : (
                  <span className="bg-primary/10 text-primary shrink-0 rounded-full px-2 py-0.5 text-xs font-medium">
                    Nuevo
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {receipt.hasPdf ? (
                  <Button asChild size="lg">
                    <a
                      href={`/mi/recibos/${receipt.id}/pdf`}
                      rel="noopener"
                      target="_blank"
                    >
                      Ver PDF
                    </a>
                  </Button>
                ) : null}
                <Button
                  asChild
                  className={receipt.hasPdf ? undefined : "col-span-2"}
                  size="lg"
                  variant="secondary"
                >
                  <a href={`/mi/recibos/${receipt.id}/xml`}>Descargar XML</a>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
};

export default EmployeeReceiptsPage;
