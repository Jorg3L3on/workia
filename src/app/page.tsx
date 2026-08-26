import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-background p-6">
      <main className="flex w-full max-w-2xl flex-col items-center gap-8 text-center">
        <div className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">
            workia
          </h1>
          <p className="text-lg text-muted-foreground">
            Next.js 16, shadcn/ui, Drizzle ORM, and PostgreSQL with RBAC.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/admin/rbac">View RBAC Admin</Link>
          </Button>
          <Button asChild variant="outline">
            <a
              href="https://nextjs.org/docs"
              target="_blank"
              rel="noopener noreferrer"
            >
              Next.js Docs
            </a>
          </Button>
        </div>
      </main>
    </div>
  );
}
