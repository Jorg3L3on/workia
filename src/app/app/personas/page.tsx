import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { PersonasDataTable } from "@/components/people/personas-data-table";
import { Button } from "@/components/ui/button";
import { listPeople } from "@/lib/people";
import { assertPeopleListAccess } from "@/lib/people/actions";
import { formatPersonName } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
            Expediente
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Personas</h1>
          <p className="text-muted-foreground text-sm">
            Expediente de empleados con datos de empresa e identificadores.
          </p>
        </div>
        {canCreate ? (
          <Button
            asChild
            className="workia-accent-gradient border-0 text-white shadow-md hover:opacity-95"
          >
            <Link href="/app/personas/nueva">
              <PlusIcon className="size-4" aria-hidden />
              Nueva persona
            </Link>
          </Button>
        ) : null}
      </header>

      <PersonasDataTable
        emptyAction={
          canCreate ? (
            <Button asChild variant="outline">
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
