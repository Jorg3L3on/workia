import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon, SearchIcon } from "lucide-react";

import { pageTitles } from "@/lib/brand/chrome-copy";
import { FormSelect } from "@/components/ui/form-select";
import { ListPageHeader } from "@/components/list/list-page-header";
import { AssetsDataTable } from "@/components/resguardo/assets-data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseListPaging } from "@/lib/list/paging";
import { listAssetsPage } from "@/lib/resguardo";
import { assertAssetsListAccess } from "@/lib/resguardo/actions";
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
    page?: string;
    pageSize?: string;
  }>;
};

const ResguardoPage = async ({ searchParams }: ResguardoPageProps) => {
  const session = await assertAssetsListAccess();
  const params = await searchParams;
  const { q, status, deleted, error } = params;
  const { page, pageSize } = parseListPaging(params);

  const [{ items, total }, canCreate, canUpdate] = await Promise.all([
    listAssetsPage(session.companyId, { query: q, status, page, pageSize }),
    userHasPermission(session.user.id, "assets:create"),
    userHasPermission(session.user.id, "assets:update"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <ListPageHeader
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/app/resguardo/nuevo">
                <PlusIcon className="size-4" aria-hidden />
                Nuevo activo
              </Link>
            </Button>
          ) : undefined
        }
        description="Qué existe, quién lo tiene hoy y el historial de entregas y devoluciones."
        descriptionSecondary="Lista de todos los activos registrados."
        title="Resguardo"
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
            className="bg-card h-10 rounded-lg pl-9"
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
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
      </form>

      <AssetsDataTable
        assets={items}
        canUpdate={canUpdate}
        emptyAction={
          canCreate && !q && !status ? (
            <Button asChild>
              <Link href="/app/resguardo/nuevo">Registrar primer activo</Link>
            </Button>
          ) : undefined
        }
        emptyDescription={
          canCreate
            ? "Registra el primer activo para empezar el inventario."
            : "Cuando existan registros, los verás aquí."
        }
        hasFilters={Boolean(q || status)}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </div>
  );
};

export default ResguardoPage;
