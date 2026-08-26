import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="bg-background flex min-h-full flex-1 flex-col items-center justify-center p-6">
      <main className="flex w-full max-w-2xl flex-col items-center gap-8 text-center">
        <div className="space-y-3">
          <h1 className="text-foreground text-4xl font-semibold tracking-tight">
            workia
          </h1>
          <p className="text-muted-foreground text-lg">
            Next.js 16, shadcn/ui, Drizzle, Auth.js, and RBAC — single tenant.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/app">Open app</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/admin">Admin</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
