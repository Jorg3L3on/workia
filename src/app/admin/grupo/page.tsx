import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import {
  GroupAdminForm,
  RevokeGroupAdminButton,
} from "@/components/transfers/group-admin-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listGroupAdmins } from "@/lib/transfers/group-admins";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Administración del grupo",
};

/**
 * Platform console (the layout checks platform access): who holds the group
 * admin grant (W2-24). It lets them read a person's history across every
 * company of the group; it changes nothing they can write.
 */
const GrupoAdminPage = async () => {
  const admins = await listGroupAdmins();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        description="Quien tiene este acceso consulta el historial del grupo de una persona trasladada en todas las empresas, aunque no sea miembro de ellas. No puede editar nada fuera de sus empresas."
        title="Administración del grupo"
      />

      <Card>
        <CardHeader>
          <CardTitle>Dar acceso</CardTitle>
          <CardDescription>
            La cuenta ya debe existir en Workia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GroupAdminForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Con acceso</CardTitle>
        </CardHeader>
        <CardContent>
          {admins.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nadie tiene acceso al historial del grupo.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {admins.map((admin) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                  key={admin.id}
                >
                  <div>
                    <p className="text-sm font-medium">{admin.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {admin.email}
                    </p>
                  </div>
                  <RevokeGroupAdminButton email={admin.email} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GrupoAdminPage;
