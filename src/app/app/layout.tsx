import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { requireAuth } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: pageTitles.inicio,
};

type AppLayoutProps = {
  children: React.ReactNode;
};

export default async function AppLayout({ children }: AppLayoutProps) {
  const session = await requireAuth();

  return <AppShell user={session.user}>{children}</AppShell>;
}
