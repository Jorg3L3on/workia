import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PrintButton } from "@/components/people/print-button";
import { getSeniorityCertificate } from "@/lib/contracts";
import {
  contractStatusLabels,
  contractTypeLabels,
  formatContractDate,
} from "@/lib/contracts/schema";
import { isoToday } from "@/lib/format/date";
import { requirePeopleRead } from "@/lib/people/auth";
import { formatPersonName } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Constancia de antigüedad",
};

type ConstanciaPageProps = {
  params: Promise<{ id: string }>;
};

/** Printable seniority certificate (WRK-I5-5): hire date, seniority and contracts. */
const ConstanciaPage = async ({ params }: ConstanciaPageProps) => {
  const session = await requirePeopleRead();
  const { id } = await params;

  if (!(await userHasPermission(session.user.id, "contracts:read"))) {
    notFound();
  }

  const today = isoToday();
  const certificate = await getSeniorityCertificate(
    session.companyId,
    id,
    today,
  );

  if (!certificate) {
    notFound();
  }

  const { person, company, contratos } = certificate;
  const companyName = company?.legalName || company?.name || "La empresa";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 print:max-w-none">
      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
        <PrintButton />
      </div>

      <article
        className="workia-pass-card space-y-6 p-8 print:border-0 print:p-0 print:shadow-none"
        data-testid="seniority-certificate"
      >
        <header className="space-y-1 text-center">
          <p className="text-muted-foreground text-xs tracking-widest uppercase">
            {companyName}
            {company?.rfc ? ` · RFC ${company.rfc}` : ""}
          </p>
          <h1 className="text-xl font-semibold">Constancia de antigüedad</h1>
        </header>

        <p className="leading-relaxed">
          {companyName} hace constar que{" "}
          <strong>{formatPersonName(person)}</strong>
          {person.curp ? ` (CURP ${person.curp})` : ""}{" "}
          {certificate.fechaIngreso ? (
            <>
              ingresó a laborar el{" "}
              <strong>{formatContractDate(certificate.fechaIngreso)}</strong> y
              al {formatContractDate(today)} cuenta con una antigüedad de{" "}
              <strong>{certificate.antiguedad ?? "menos de un mes"}</strong>
            </>
          ) : (
            "no tiene fecha de ingreso capturada"
          )}
          {person.position?.name
            ? `, con el puesto de ${person.position.name}`
            : ""}
          .
        </p>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Contratos</h2>
          {contratos.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Sin contratos registrados.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="py-1 font-medium">Tipo</th>
                  <th className="py-1 font-medium">Inicio</th>
                  <th className="py-1 font-medium">Fin</th>
                  <th className="py-1 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {contratos.map((contract) => (
                  <tr key={contract.id} className="border-t">
                    <td className="py-1">
                      {contractTypeLabels[contract.type]}
                    </td>
                    <td className="py-1">
                      {formatContractDate(contract.startDate)}
                    </td>
                    <td className="py-1">
                      {contract.endDate
                        ? formatContractDate(contract.endDate)
                        : "—"}
                    </td>
                    <td className="py-1">
                      {contractStatusLabels[contract.status]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="text-muted-foreground text-sm">
          Se extiende la presente el {formatContractDate(today)}.
        </p>

        <div className="grid gap-12 pt-12 sm:grid-cols-2">
          <div className="border-t pt-2 text-center text-xs">
            Nombre y firma de quien expide
          </div>
          <div className="border-t pt-2 text-center text-xs">Sello</div>
        </div>
      </article>
    </div>
  );
};

export default ConstanciaPage;
