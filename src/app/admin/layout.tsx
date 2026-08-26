import { AdminShell } from "@/components/layout/admin-shell";
import { requireAdminAccess } from "@/lib/auth/session";

type AdminLayoutProps = {
  children: React.ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  await requireAdminAccess();

  return <AdminShell>{children}</AdminShell>;
}
