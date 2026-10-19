import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { NewCompanySheet } from "@/components/tenant/company-form";
import { CompaniesDataTable } from "@/components/tenant/companies-data-table";
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
      <PageHeader
        description="Cada empresa tiene sus propios datos; nadie ve los de otra sin ser miembro de ella."
        primary={<NewCompanySheet />}
        title="Empresas"
      />

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
