import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { VacationConstanciaDocument } from "@/components/people/vacation-constancia";
import { isoToday } from "@/lib/format/date";
import { requirePeopleRead } from "@/lib/people/auth";
import { getVacationConstancia } from "@/lib/vacations/constancia";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Constancia de vacaciones",
};

type VacationConstanciaPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ anio?: string | string[] }>;
};

/** A service year from `?anio=`, or null to use the year that contains today. */
const readServiceYear = (
  value: string | string[] | undefined,
): number | null | "invalid" => {
  if (value === undefined) {
    return null;
  }

  if (Array.isArray(value) || !/^[1-9]\d{0,2}$/.test(value)) {
    return "invalid";
  }

  return Number(value);
};

/**
 * Printable vacation constancia (WRK-I14-4). Needs vacations:read and
 * contracts:read. A missing permission and a person outside the company
 * both end as not found, so the answer does not reveal which one it was.
 */
const VacationConstanciaPage = async ({
  params,
  searchParams,
}: VacationConstanciaPageProps) => {
  const session = await requirePeopleRead();
  const { id } = await params;
  const { anio } = await searchParams;
  const serviceYear = readServiceYear(anio);

  if (
    serviceYear === "invalid" ||
    !session.permissions.has("vacations:read") ||
    !session.permissions.has("contracts:read")
  ) {
    notFound();
  }

  const constancia = await getVacationConstancia(
    session.companyId,
    id,
    isoToday(),
    serviceYear,
  );

  if (!constancia) {
    notFound();
  }

  return <VacationConstanciaDocument constancia={constancia} />;
};

export default VacationConstanciaPage;
