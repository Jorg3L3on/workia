import type { Metadata } from "next";
import { BellIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { InstallPrompt } from "@/components/employee/install-prompt";
import { WorkiaMark } from "@/components/brand/workia-mark";
import { Button } from "@/components/ui/button";
import { signOutEmployeeAction } from "@/lib/employee/actions";
import { getEmployeeHome } from "@/lib/employee/home";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { countUnread, personRecipient } from "@/lib/notifications";

export const metadata: Metadata = { title: "Inicio" };

/**
 * Home of the employee app (W2-01). Everything comes from the session's
 * person; the route takes no id. W2-02 Mi expediente grows from here.
 */
const EmployeeHomePage = async () => {
  const context = await requireEmployeeContext();
  const [home, unread] = await Promise.all([
    getEmployeeHome(context),
    countUnread(context.companyId, personRecipient(context.personId)),
  ]);

  if (!home) {
    notFound();
  }

  const fullName = [home.nombres, home.apellidoPaterno, home.apellidoMaterno]
    .filter(Boolean)
    .join(" ");
  const facts = [
    { label: "Puesto", value: home.positionName },
    { label: "Área", value: home.areaName },
    { label: "Sucursal", value: home.siteName },
    { label: "Correo de acceso", value: home.email },
  ].filter((fact) => fact.value);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-6 pb-10">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <WorkiaMark />
          <span className="text-muted-foreground text-sm font-medium">
            {home.companyName}
          </span>
        </div>
        <form action={signOutEmployeeAction}>
          <Button size="lg" type="submit" variant="ghost">
            Salir
          </Button>
        </form>
      </header>

      <section className="space-y-1 pt-2">
        <p className="text-muted-foreground text-sm">Hola,</p>
        <h1 className="text-2xl font-semibold tracking-tight">{fullName}</h1>
      </section>

      <InstallPrompt />

      <Link
        className="workia-pass-card flex items-center justify-between gap-3 px-5 py-4"
        href="/mi/avisos"
      >
        <span className="flex items-center gap-2.5 text-base font-semibold">
          <BellIcon aria-hidden className="size-5" />
          Avisos
        </span>
        <span className="text-muted-foreground text-sm">
          {unread > 0
            ? `${unread >= 100 ? "99+" : unread} sin leer`
            : "Nada nuevo"}
        </span>
      </Link>

      <section
        aria-labelledby="mi-datos"
        className="workia-pass-card flex flex-col gap-3 px-5 py-4"
      >
        <h2 className="text-base font-semibold" id="mi-datos">
          Mis datos
        </h2>
        {facts.length > 0 ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {facts.map((fact) => (
              <div className="min-w-0" key={fact.label}>
                <dt className="workia-field-label">{fact.label}</dt>
                <dd className="font-medium break-words">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">
            RH aún no captura tu puesto ni tu sucursal.
          </p>
        )}
      </section>
    </main>
  );
};

export default EmployeeHomePage;
