import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageBreadcrumbLabel } from "@/components/layout/app-breadcrumbs";
import { PageHeader } from "@/components/layout/page-header";
import {
  CompanyForm,
  CompanyStatusButton,
} from "@/components/tenant/company-form";
import { MembersPanel } from "@/components/tenant/members-panel";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { requireAuth } from "@/lib/auth/session";
import { getCompanyById } from "@/lib/tenant/companies";
import { listCompanyMembers, listRoles } from "@/lib/tenant/members";
import { toneFor } from "@/lib/ui/status-tone";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.empresas,
};

type EmpresaPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
};

/** One company: its data, its status and its members (any role). Platform admins only. */
const EmpresaPage = async ({ params, searchParams }: EmpresaPageProps) => {
  const session = await requireAuth();
  const { id } = await params;
  const { created } = await searchParams;
  const company = /^[0-9a-f-]{36}$/i.test(id) ? await getCompanyById(id) : null;

  if (!company) {
    notFound();
  }

  const [members, roles] = await Promise.all([
    listCompanyMembers(company.id),
    listRoles(),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageBreadcrumbLabel label={company.name} />
      <PageHeader
        menu={
          <CompanyStatusButton companyId={company.id} status={company.status} />
        }
        meta={<span className="font-mono">{company.slug}</span>}
        primary={{ label: "Guardar cambios", form: "company-form" }}
        status={
          <Badge tone={toneFor("company", company.status)}>
            {company.status === "activa" ? "Activa" : "Suspendida"}
          </Badge>
        }
        title={company.name}
        variant="detail"
      />

      {created ? (
        <p className="text-sm font-medium" role="status">
          Empresa creada. Agrega a su primera persona administradora.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Datos de la empresa</CardTitle>
        </CardHeader>
        <CardContent>
          <CompanyForm
            company={{
              id: company.id,
              name: company.name,
              slug: company.slug,
              legalName: company.legalName,
              rfc: company.rfc,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Miembros</CardTitle>
          <CardDescription>
            Si la persona aún no tiene cuenta, se crea con su correo y entra con
            Google usando ese correo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MembersPanel
            members={members}
            roles={roles}
            canManage
            currentUserId={session.user.id}
            scope={{ kind: "platform", targetCompanyId: company.id }}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default EmpresaPage;
