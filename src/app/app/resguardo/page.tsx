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
import { listAssets } from "@/lib/resguardo";
import { assertAssetsListAccess } from "@/lib/resguardo/actions";
import { assetCategoryLabels, assetStatusLabels } from "@/lib/resguardo/schema";
import { userHasPermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-muted-foreground font-mono text-[10.5px] font-medium tracking-[0.09em] uppercase">
            Resguardo
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Inventario</h1>
          <p className="text-muted-foreground text-sm">
            Qué existe, quién lo tiene hoy y el historial de entregas y
            devoluciones.
          </p>
        </div>
        {canCreate ? (
          <Button
            asChild
            className="workia-accent-gradient border-0 text-white shadow-md hover:opacity-95"
          >
            <Link href="/app/resguardo/nuevo">
              <PlusIcon className="size-4" aria-hidden />
              Nuevo activo
            </Link>
          </Button>
        ) : null}
      </header>

      {deleted === "1" ? (
        <p
          className="text-sm font-medium text-[color:var(--workia-accent-violet)]"
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
              placeholder="Nombre, identificador o categoría"
            />
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="status">
            Estado
          </label>
          <select
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full min-w-40 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
            defaultValue={status ?? ""}
            id="status"
            name="status"
          >
            <option value="">Todos</option>
            <option value="disponible">En almacén</option>
            <option value="asignado">Asignado</option>
            <option value="baja">Baja</option>
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>

      <div className="workia-pass-card overflow-hidden rounded-xl border">
        {items.length === 0 ? (
          <div className="workia-empty-state m-4 px-4 py-8 text-center">
            <p className="text-sm font-medium">
              {q || status
                ? "No hay coincidencias"
                : "Aún no hay activos registrados"}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {canCreate
                ? "Registra el primer activo para empezar el inventario."
                : "Cuando existan registros, los verás aquí."}
            </p>
          </div>
        ) : (
          <Table>
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
                <TableRow key={item.id} className="hover:bg-muted/40">
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
                    <Badge
                      variant={
                        item.status === "asignado" ? "default" : "secondary"
                      }
                    >
                      {assetStatusLabels[item.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.holderName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      className="text-primary text-sm font-medium hover:underline"
                      href={`/app/resguardo/${item.id}`}
                    >
                      Ver detalle
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

export default ResguardoPage;
