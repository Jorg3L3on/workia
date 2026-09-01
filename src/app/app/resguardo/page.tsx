import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon, SearchIcon } from "lucide-react";

import { pageTitles } from "@/lib/brand/chrome-copy";
import { FormSelect } from "@/components/ui/form-select";
import {
  ListPageHeader,
  listPrimaryActionClassName,
} from "@/components/list/list-page-header";
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
import { listAssets } from "@/lib/resguardo";
import { assertAssetsListAccess } from "@/lib/resguardo/actions";
import { assetCategoryLabels, assetStatusLabels } from "@/lib/resguardo/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.resguardo,
};

type ResguardoPageProps = {
  searchParams: Promise<{
    q?: string;
    status?: "disponible" | "asignado" | "baja";
    deleted?: string;
    error?: string;
  }>;
};

const ResguardoPage = async ({ searchParams }: ResguardoPageProps) => {
  const session = await assertAssetsListAccess();
  const { q, status, deleted, error } = await searchParams;

  const [items, canCreate] = await Promise.all([
    listAssets({ query: q, status }),
    userHasPermission(session.user.id, "assets:create"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <ListPageHeader
        actions={
          canCreate ? (
            <Button asChild className={listPrimaryActionClassName}>
              <Link href="/app/resguardo/nuevo">
                <PlusIcon className="size-4" aria-hidden />
                Nuevo activo
              </Link>
            </Button>
          ) : undefined
        }
        description="Qué existe, quién lo tiene hoy y el historial de entregas y devoluciones."
        descriptionSecondary="Lista de todos los activos registrados."
        title="Inventario"
      />

      {deleted === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          role="status"
        >
          Activo dado de baja.
        </p>
      ) : null}

      {error === "delete-permission" ? (
        <p className="text-destructive text-sm" role="alert">
          No tienes permiso para dar de baja activos.
        </p>
      ) : null}

      <form className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1">
          <SearchIcon
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            aria-label="Buscar activos"
            className="bg-card h-10 rounded-xl pl-9"
            defaultValue={q ?? ""}
            id="q"
            name="q"
            placeholder="Buscar activos..."
          />
        </div>
        <div className="sm:w-48">
          <label className="sr-only" htmlFor="status">
            Estado
          </label>
          <FormSelect
            aria-label="Estado"
            defaultValue={status ?? ""}
            id="status"
            name="status"
            options={[
              { value: "", label: "Todos los estados" },
              { value: "disponible", label: "En almacén" },
              { value: "asignado", label: "Asignado" },
              { value: "baja", label: "Baja" },
            ]}
          />
        </div>
        <Button className="h-10 rounded-full" type="submit" variant="outline">
          Filtrar
        </Button>
        <ListResultCount
          count={items.length}
          plural="activos"
          singular="activo"
        />
      </form>

      <ListTableShell>
        {items.length === 0 ? (
          <ListEmptyState
            action={
              canCreate && !q && !status ? (
                <Button asChild className={listPrimaryActionClassName}>
                  <Link href="/app/resguardo/nuevo">
                    Registrar primer activo
                  </Link>
                </Button>
              ) : undefined
            }
            description={
              canCreate
                ? "Registra el primer activo para empezar el inventario."
                : "Cuando existan registros, los verás aquí."
            }
            title={
              q || status
                ? "No hay coincidencias"
                : "Aún no hay activos registrados"
            }
          />
        ) : (
          <Table className={listTableDensityClassName}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Activo</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Resguardante</TableHead>
                <TableHead className="text-right">Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {item.identifier}
                        {!item.tracksHistory ? " · sin historial" : ""}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {assetCategoryLabels[item.category] ?? item.category}
                  </TableCell>
                  <TableCell>
                    <ListStatusBadge
                      tone={
                        item.status === "asignado"
                          ? "active"
                          : item.status === "baja"
                            ? "destructive"
                            : "inactive"
                      }
                    >
                      {assetStatusLabels[item.status]}
                    </ListStatusBadge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.holderName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <ListRowAction
                      aria-label={`Ver detalle de ${item.name}`}
                      href={`/app/resguardo/${item.id}`}
                    >
                      Ver detalle
                    </ListRowAction>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListTableShell>
    </div>
  );
};

export default ResguardoPage;
