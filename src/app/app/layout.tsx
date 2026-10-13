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

  return <AppShell user={session.user}>{children}</AppShell>;
}
