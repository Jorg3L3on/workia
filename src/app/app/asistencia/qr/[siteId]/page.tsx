import type { Metadata } from "next";
import { forbidden, notFound } from "next/navigation";

import { KioskQr } from "@/components/attendance/attendance-forms";
import { checkinSiteFor } from "@/lib/attendance/checkin";
import { requireCompanyPage } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Código para checar" };

type KioskPageProps = { params: Promise<{ siteId: string }> };

/**
 * The QR a site shows for app check-in (W2-12): open it on a screen at the
 * site with an HR session (attendance:manage), or print it when the site
 * uses a printed code.
 */
const KioskPage = async ({ params }: KioskPageProps) => {
  const session = await requireCompanyPage();

  if (!session.permissions.has("attendance:manage")) {
    forbidden();
  }

  const { siteId } = await params;
  const site = await checkinSiteFor(session.companyId, siteId);

  if (!site) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{site.siteName}</h1>
      <p className="text-muted-foreground">
        Escanea el código con la cámara de tu teléfono para checar entrada o
        salida en Mi Workia.
      </p>
      <KioskQr siteId={site.siteId} />
    </div>
  );
};

export default KioskPage;
