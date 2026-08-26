import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const AdminRbacPage = async () => {
  const [matrix, usersWithRoles] = await Promise.all([
    getRolePermissionMatrix(),
    getUsersWithRoles(),
  ]);

  const demoUser = usersWithRoles[0];

  const demoPermissions = demoUser
    ? await getUserPermissions(demoUser.id)
    : [];

  return (
    <div className="min-h-full bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              RBAC Administration
            </h1>
            <p className="text-sm text-muted-foreground">
              Role-based access control powered by Drizzle and PostgreSQL.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">Back to home</Link>
          </Button>
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
              <CardDescription>Permissions</CardDescription>
              <CardTitle className="text-3xl">
                {matrix.permissions.length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Users</CardDescription>
              <CardTitle className="text-3xl">{usersWithRoles.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="roles" className="gap-4">
          <TabsList>
            <TabsTrigger value="roles">Roles & Permissions</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="demo">Permission Check</TabsTrigger>
          </TabsList>

          <TabsContent value="roles">
            <Card>
              <CardHeader>
                <CardTitle>Role Permission Matrix</CardTitle>
                <CardDescription>
                  Typical RBAC mapping of roles to resource actions.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Permission</TableHead>
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
                          <div className="font-medium">{permission.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {permission.slug}
                          </div>
                        </TableCell>
                        {matrix.roles.map((role) => (
                          <TableCell key={role.id} className="text-center">
                            {matrix.hasPermission(role.id, permission.id) ? (
                              <Badge variant="secondary">Allowed</Badge>
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
                <CardTitle>Users</CardTitle>
                <CardDescription>
                  Seeded demo users with assigned roles.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Roles</TableHead>
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
                              <Badge key={role}>{role}</Badge>
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
                <CardTitle>Runtime Permission Check</CardTitle>
                <CardDescription>
                  Example of evaluating permissions for a user via{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    getUserPermissions()
                  </code>
                  .
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {demoUser ? (
                  <>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{demoUser.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {demoUser.email}
                      </p>
                    </div>
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      {demoPermissions.map((permission) => (
                        <Badge key={permission} variant="outline">
                          {permission}
                        </Badge>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Run <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run db:seed</code>{" "}
                    to populate demo users.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default AdminRbacPage;
