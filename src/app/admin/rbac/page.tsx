import type { Metadata } from "next";

import { PermissionTag } from "@/components/rbac/permission-tag";
import { Badge, Tag } from "@/components/ui/badge";
import { pageTitles } from "@/lib/brand/chrome-copy";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getRolePermissionMatrix,
  getUserPermissions,
  getUsersWithRoles,
} from "@/lib/rbac";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.rbac,
};

const AdminRbacPage = async () => {
  const [matrix, usersWithRoles] = await Promise.all([
    getRolePermissionMatrix(),
    getUsersWithRoles(),
  ]);

  const demoUser = usersWithRoles[0];

  const demoPermissions = demoUser ? await getUserPermissions(demoUser.id) : [];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {pageTitles.rbac}
        </h1>
        <p className="text-muted-foreground text-sm">
          Qué puede hacer cada rol y qué rol tiene cada usuario.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Roles</CardDescription>
            <CardTitle className="text-3xl">{matrix.roles.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Permisos</CardDescription>
            <CardTitle className="text-3xl">
              {matrix.permissions.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Usuarios</CardDescription>
            <CardTitle className="text-3xl">{usersWithRoles.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs defaultValue="roles" className="gap-4">
        <TabsList>
          <TabsTrigger value="roles">Permisos por rol</TabsTrigger>
          <TabsTrigger value="users">Usuarios</TabsTrigger>
          <TabsTrigger value="demo">Permisos de un usuario</TabsTrigger>
        </TabsList>

        <TabsContent value="roles">
          <Card>
            <CardHeader>
              <CardTitle>Permisos por rol</CardTitle>
              <CardDescription>
                Cada fila es un permiso; cada columna, un rol.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Permiso</TableHead>
                    {matrix.roles.map((role) => (
                      <TableHead key={role.id} className="text-center">
                        {role.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matrix.permissions.map((permission) => (
                    <TableRow key={permission.id}>
                      <TableCell>
                        <PermissionTag slug={permission.slug} />
                      </TableCell>
                      {matrix.roles.map((role) => (
                        <TableCell key={role.id} className="text-center">
                          {matrix.hasPermission(role.id, permission.id) ? (
                            <Badge tone="success">Sí</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle>Usuarios</CardTitle>
              <CardDescription>
                El rol de cada usuario en cada empresa y su acceso a la
                plataforma.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Correo</TableHead>
                    <TableHead>Acceso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersWithRoles.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {user.roles.map((role) => (
                            <Tag key={role}>{role}</Tag>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="demo">
          <Card>
            <CardHeader>
              <CardTitle>Permisos de un usuario</CardTitle>
              <CardDescription>
                Todo lo que puede hacer el primer usuario de la lista, sumando
                sus roles.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {demoUser ? (
                <>
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{demoUser.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {demoUser.email}
                    </p>
                  </div>
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    {demoPermissions.map((permission) => (
                      <PermissionTag key={permission} slug={permission} />
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Todavía no hay usuarios.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminRbacPage;
