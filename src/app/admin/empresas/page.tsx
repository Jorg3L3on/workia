import type { Metadata } from "next";
import Link from "next/link";

import { CompanyForm } from "@/components/tenant/company-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Identificador</TableHead>
                <TableHead>Miembros</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id} data-testid="company-row">
                  <TableCell>
                    <Link
                      href={`/admin/empresas/${company.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {company.name}
                    </Link>
                    {company.legalName ? (
                      <div className="text-muted-foreground text-xs">
                        {company.legalName}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {company.slug}
                  </TableCell>
                  <TableCell>{company.members}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        company.status === "activa" ? "secondary" : "outline"
                      }
                    >
                      {company.status === "activa" ? "Activa" : "Suspendida"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default EmpresasPage;
