import type { Metadata } from "next";

import { AdminShell } from "@/components/layout/admin-shell";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { requirePlatformAdmin } from "@/lib/tenant/context";

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
  await requirePlatformAdmin();

  return <AdminShell>{children}</AdminShell>;
}
