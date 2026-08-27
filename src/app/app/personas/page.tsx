import Link from "next/link";
import { PlusIcon, SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listPeople } from "@/lib/people";
import { assertPeopleListAccess } from "@/lib/people/actions";
import { formatPersonName, personStatusLabels } from "@/lib/people/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type PersonasPageProps = {
  searchParams: Promise<{
    q?: string;
    status?: "activa" | "baja";
  }>;
};

const PersonasPage = async ({ searchParams }: PersonasPageProps) => {
  const session = await assertPeopleListAccess();
  const { q, status } = await searchParams;

  const [people, canCreate] = await Promise.all([
    listPeople({ query: q, status }),
    userHasPermission(session.user.id, "people:create"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
            Expediente
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Personas</h1>
          <p className="text-muted-foreground text-sm">
            Cada persona vive aquí — base para contratos y resguardo después.
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

      <form className="workia-pass-card flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium" htmlFor="q">
            Buscar
          </label>
          <div className="relative">
            <SearchIcon
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              className="pl-8"
              defaultValue={q ?? ""}
              id="q"
              name="q"
              placeholder="Nombre, apellidos o correo"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="status">
            Relación
          </label>
          <select
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full min-w-40 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
            defaultValue={status ?? ""}
            id="status"
            name="status"
          >
            <option value="">Todas</option>
            <option value="activa">Activas</option>
            <option value="baja">Bajas</option>
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>

      <div className="workia-pass-card overflow-hidden">
        {people.length === 0 ? (
          <div className="workia-empty-state m-4 px-4 py-8 text-center">
            <p className="text-sm font-medium">
              {q || status
                ? "No hay coincidencias"
                : "Aún no hay personas en el expediente"}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {canCreate
                ? "Da de alta a alguien para que contratos y resguardo tengan a quién ligar."
                : "Cuando existan registros, los verás aquí."}
            </p>
            {canCreate && !q && !status ? (
              <Button asChild className="mt-4" variant="outline">
                <Link href="/app/personas/nueva">
                  Dar de alta a la primera persona
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Relación</TableHead>
                <TableHead className="text-right">Expediente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((person) => (
                <TableRow key={person.id}>
                  <TableCell className="font-medium">
                    {formatPersonName(person)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {person.email ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        person.status === "activa" ? "default" : "secondary"
                      }
                    >
                      {personStatusLabels[person.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      className="workia-accent-text text-sm font-medium hover:underline"
                      href={`/app/personas/${person.id}`}
                    >
                      Ver expediente
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
};

export default PersonasPage;
