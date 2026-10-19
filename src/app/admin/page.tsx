import type { Metadata } from "next";
import Link from "next/link";

import { PermissionTag } from "@/components/rbac/permission-tag";
import { Tag } from "@/components/ui/badge";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/tenant/context";
import { getUserPermissions } from "@/lib/rbac";

export const metadata: Metadata = {
  title: pageTitles.administracion,
};

const SHOWN_PERMISSIONS = 6;

export default async function AdminPage() {
  const session = await requirePlatformAdmin();
  const permissions = await getUserPermissions(session.user.id);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Administración
        </h1>
        <p className="text-muted-foreground text-sm">
          Empresas de la plataforma, sus roles y permisos.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Empresas</CardTitle>
            <CardDescription>
              Alta de empresas, suspensión y miembros de cada una.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/empresas">Ver empresas</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{pageTitles.rbac}</CardTitle>
            <CardDescription>
              Qué puede hacer cada rol y quién tiene cada rol.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="secondary">
              <Link href="/admin/rbac">Ver roles y permisos</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tus permisos</CardTitle>
            <CardDescription>
              Lo que tu cuenta puede hacer en la plataforma.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {permissions.slice(0, SHOWN_PERMISSIONS).map((permission) => (
                <PermissionTag key={permission} slug={permission} />
              ))}
              {permissions.length > SHOWN_PERMISSIONS ? (
                <Tag>{permissions.length - SHOWN_PERMISSIONS} más</Tag>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
