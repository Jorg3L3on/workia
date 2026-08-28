import Link from "next/link";
import { PlusIcon, SearchIcon } from "lucide-react";

import { PersonasMobileList } from "@/components/people/personas-mobile-list";
import { ClickableTableRow } from "@/components/list/clickable-table-row";
import { ListFilterBar } from "@/components/list/list-filter-bar";
import { ListRowAction } from "@/components/list/list-row-action";
import { ListStatusBadge } from "@/components/list/list-status-badge";
import {
  ListEmptyState,
  ListResultCount,
  ListTableShell,
  listTableDensityClassName,
} from "@/components/list/list-table-shell";
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

  const hasFilters = Boolean(q || status);

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

      <ListFilterBar
        footer={
          <ListResultCount
            count={people.length}
            plural="resultados"
            singular="resultado"
          />
        }
      >
        <div className="min-w-0 flex-1 space-y-2">
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
              placeholder="Nombre, RFC, CURP o correo"
            />
          </div>
        </div>
        <div className="space-y-2 sm:w-44">
          <label className="text-sm font-medium" htmlFor="status">
            Relación
          </label>
          <select
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
            defaultValue={status ?? ""}
            id="status"
            name="status"
          >
            <option value="">Todas</option>
            <option value="activa">Activas</option>
            <option value="baja">Bajas</option>
          </select>
        </div>
        <Button className="sm:self-end" type="submit" variant="outline">
          Filtrar
        </Button>
      </ListFilterBar>

      {people.length === 0 ? (
        <ListTableShell>
          <ListEmptyState
            action={
              canCreate && !hasFilters ? (
                <Button asChild variant="outline">
                  <Link href="/app/personas/nueva">
                    Dar de alta a la primera persona
                  </Link>
                </Button>
              ) : undefined
            }
            description={
              canCreate
                ? "Da de alta a alguien para empezar el expediente."
                : "Cuando existan registros, los verás aquí."
            }
            title={
              hasFilters
                ? "No hay coincidencias"
                : "Aún no hay personas en el expediente"
            }
          />
        </ListTableShell>
      ) : (
        <>
          <PersonasMobileList people={people} />

          <ListTableShell desktopOnly>
            <Table className={listTableDensityClassName}>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>RFC</TableHead>
                  <TableHead>Relación</TableHead>
                  <TableHead className="text-right">Expediente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((person) => (
                  <ClickableTableRow
                    key={person.id}
                    ariaLabel={`Ver expediente de ${formatPersonName(person)}`}
                    href={`/app/personas/${person.id}`}
                  >
                    <TableCell className="font-medium">
                      {formatPersonName(person)}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {person.rfc ?? "—"}
                    </TableCell>
                    <TableCell>
                      <ListStatusBadge
                        tone={
                          person.status === "activa" ? "active" : "inactive"
                        }
                      >
                        {personStatusLabels[person.status]}
                      </ListStatusBadge>
                    </TableCell>
                    <TableCell className="text-right">
                      <ListRowAction
                        aria-label={`Ver expediente de ${formatPersonName(person)}`}
                        href={`/app/personas/${person.id}`}
                      >
                        Ver expediente
                      </ListRowAction>
                    </TableCell>
                  </ClickableTableRow>
                ))}
              </TableBody>
            </Table>
          </ListTableShell>
        </>
      )}
    </div>
  );
};

export default PersonasPage;
