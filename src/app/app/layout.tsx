import { AppShell } from "@/components/layout/app-shell";
import { requireAuth } from "@/lib/auth/session";

type AppLayoutProps = {
  children: React.ReactNode;
};

export default async function AppLayout({ children }: AppLayoutProps) {
  const session = await requireAuth();

  return <AppShell user={session.user}>{children}</AppShell>;
}
