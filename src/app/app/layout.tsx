import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { requireCompanyPage } from "@/lib/tenant/context";

export const metadata: Metadata = {
  title: {
    default: pageTitles.inicio,
    template: "%s — workia",
  },
};

type AppLayoutProps = {
  children: React.ReactNode;
};

export default async function AppLayout({ children }: AppLayoutProps) {
  // No active company: off to /empresa (pick one, or "no perteneces a ninguna").
  const session = await requireCompanyPage();

  const toOption = (membership: (typeof session.memberships)[number]) => ({
    id: membership.companyId,
    name: membership.companyName,
    roleName: membership.roleName,
  });

  return (
    <AppShell
      user={session.user}
      company={toOption(session.membership)}
      companies={session.memberships.map(toOption)}
      canReadMembers={session.permissions.has("members:read")}
      canUseConnections={
        session.permissions.has("mcp_connections:create") ||
        session.permissions.has("mcp_connections:manage")
      }
      canReadReports={session.permissions.has("reports:read")}
      canReadDocuments={session.permissions.has("documents:read")}
      isPlatformAdmin={session.isPlatformAdmin}
    >
      {children}
    </AppShell>
  );
}
