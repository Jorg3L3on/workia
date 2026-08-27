import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireAuth } from "@/lib/auth/session";
import { getUserRoles } from "@/lib/rbac";

export default async function AppPage() {
  const session = await requireAuth();
  const roles = await getUserRoles(session.user.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome, {session.user.name}
        </h1>
        <p className="text-muted-foreground">
          This is the end-user app surface for your workia deployment.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
          <CardDescription>{session.user.email}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Roles: {roles.length > 0 ? roles.join(", ") : "No roles assigned"}
          </p>
          <Button asChild variant="outline">
            <Link href="/admin">Go to admin</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
