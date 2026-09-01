import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { pageTitles } from "@/lib/brand/chrome-copy";

import {
  ListPageHeader,
  listPrimaryActionClassName,
} from "@/components/list/list-page-header";
import { PersonasDataTable } from "@/components/people/personas-data-table";
import { Button } from "@/components/ui/button";
import { listPeople } from "@/lib/people";
import { assertPeopleListAccess } from "@/lib/people/actions";
import { formatPersonName } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.personas,
};

type PersonasPageProps = {
  searchParams: Promise<{
    q?: string;
    status?: "activa" | "baja";
    deleted?: string;
  }>;
};

const PersonasPage = async ({ searchParams }: PersonasPageProps) => {
  const session = await assertPeopleListAccess();
  const { q, status, deleted } = await searchParams;

  const [people, canCreate] = await Promise.all([
    listPeople({ includeDeleted: true }),
    userHasPermission(session.user.id, "people:create"),
  ]);

  const rows = people.map((person) => ({
    id: person.id,
    name: formatPersonName(person),
    rfc: person.rfc,
    fechaIngreso: person.fechaIngreso,
    status: person.status,
    deleted: Boolean(person.deletedAt),
    searchText: [
      formatPersonName(person),
      person.rfc,
      person.curp,
      person.email,
    ]
      .filter(Boolean)
      .join(" "),
  }));

  return (
    <div className="flex flex-col gap-6">
      <ListPageHeader
        actions={
          canCreate ? (
            <Button asChild className={listPrimaryActionClassName}>
              <Link href="/app/personas/nueva">
                <PlusIcon className="size-4" aria-hidden />
                Nueva persona
              </Link>
            </Button>
          ) : undefined
        }
        description="Gestiona expedientes, relación laboral e identificadores."
        descriptionSecondary="Lista de todas las personas registradas."
        title="Personas"
      />

      <PersonasDataTable
        emptyAction={
          canCreate ? (
            <Button asChild className={listPrimaryActionClassName}>
              <Link href="/app/personas/nueva">
                Dar de alta a la primera persona
              </Link>
            </Button>
          ) : undefined
        }
        initialSearch={q ?? ""}
        initialStatus={status ?? ""}
        initialVisibility={deleted === "1" ? "deleted" : "expediente"}
        people={rows}
      />
    </div>
  );
};

export default PersonasPage;
