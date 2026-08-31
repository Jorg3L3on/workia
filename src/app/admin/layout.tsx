import type { Metadata } from "next";

import { AdminShell } from "@/components/layout/admin-shell";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { requireAdminAccess } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: {
    default: pageTitles.administracion,
    template: "%s — workia",
  },
};

type AdminLayoutProps = {
  children: React.ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  await requireAdminAccess();

  return <AdminShell>{children}</AdminShell>;
}
