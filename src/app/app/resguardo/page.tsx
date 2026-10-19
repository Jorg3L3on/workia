import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { pageTitles } from "@/lib/brand/chrome-copy";
import { PageHeader } from "@/components/layout/page-header";
import { AssetsDataTable } from "@/components/resguardo/assets-data-table";
import { Button } from "@/components/ui/button";
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
      <PageHeader
        description="Qué existe, quién lo tiene hoy y su historial de entregas."
        primary={
          canCreate
            ? {
                label: "Nuevo activo",
                icon: PlusIcon,
                href: "/app/resguardo/nuevo",
              }
            : null
        }
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
        query={q?.trim() ?? ""}
        status={status ?? ""}
        page={page}
        pageSize={pageSize}
        total={total}
      />
    </div>
  );
};

export default ResguardoPage;
