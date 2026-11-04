import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { TeamPageHeader } from "@/components/manager/team-page-header";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import { getManagerAccess } from "@/lib/managers";
import { listApprovalsInbox } from "@/lib/managers/inbox";

export const metadata: Metadata = { title: "Aprobaciones" };

type InboxPageProps = {
  searchParams: Promise<{ cursor?: string | string[] }>;
};

/**
 * The approvals inbox (W2-07): what waits for a decision of the managers
 * this account acts for, newest first. W2-06 adds vacaciones and permisos.
 */
const InboxPage = async ({ searchParams }: InboxPageProps) => {
  const context = await requireEmployeeContext();
  const access = await getManagerAccess(context);

  if (!access) {
    notFound();
  }

  const { cursor } = await searchParams;
  const inbox = await listApprovalsInbox(access, {
    cursor: typeof cursor === "string" ? cursor : null,
  });

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-4 px-4 pt-6 pb-10">
      <TeamPageHeader
        backHref="/mi/equipo"
        backLabel="Mi equipo"
        title="Aprobaciones"
      />
      {inbox.items.length > 0 ? (
        <ul className="workia-pass-card divide-y" data-testid="inbox-list">
          {inbox.items.map((item) => (
            <li key={`${item.source}:${item.id}`}>
              <Link className="block space-y-0.5 px-5 py-3" href={item.href}>
                <span className="block font-medium">{item.title}</span>
                <span className="text-muted-foreground block text-sm">
                  {[item.personName, item.detail].filter(Boolean).join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="workia-empty-state text-muted-foreground px-5 py-4 text-sm">
          No hay nada esperando tu aprobación.
        </p>
      )}
      {inbox.next ? (
        <Link
          className="text-sm font-medium text-[color:var(--workia-accent-blue)]"
          href={`/mi/equipo/aprobaciones?cursor=${encodeURIComponent(inbox.next)}`}
        >
          Ver más
        </Link>
      ) : null}
    </main>
  );
};

export default InboxPage;
