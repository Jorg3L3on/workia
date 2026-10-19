import type { Metadata } from "next";

import { CompanyForm } from "@/components/tenant/company-form";
import { CompaniesDataTable } from "@/components/tenant/companies-data-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { listCompaniesWithCounts } from "@/lib/tenant/companies";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.empresas,
};

/** Platform console: every company of the installation. The layout checks platform access. */
const EmpresasPage = async () => {
  const companies = await listCompaniesWithCounts();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
        <p className="text-muted-foreground text-sm">
          Cada empresa tiene sus propios datos; nadie ve los de otra sin ser
          miembro de ella.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nueva empresa</CardTitle>
          <CardDescription>
            Después de crearla, agrega a su primera persona administradora.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyForm />
        </CardContent>
      </Card>

      <CompaniesDataTable
        companies={companies.map((company) => ({
          id: company.id,
          name: company.name,
          legalName: company.legalName,
          slug: company.slug,
          members: company.members,
          status: company.status,
        }))}
      />
    </div>
  );
};

export default EmpresasPage;
