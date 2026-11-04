import type { Metadata } from "next";
import Link from "next/link";

import { EmployeeCheckin } from "@/components/attendance/employee-checkin";
import { WorkiaMark } from "@/components/brand/workia-mark";
import { checkinSiteFor, CHECKIN_COPY } from "@/lib/attendance/checkin";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";

export const metadata: Metadata = { title: "Checar" };

export const dynamic = "force-dynamic";

type CheckinPageProps = {
  searchParams: Promise<{ s?: string; w?: string; m?: string }>;
};

/**
 * App check-in (W2-12). The phone camera opens this page from the site's QR
 * code; the employee picks entrada or salida and the phone sends its
 * location. The person is the session's; the site comes from the code.
 */
const CheckinPage = async ({ searchParams }: CheckinPageProps) => {
  const context = await requireEmployeeContext();
  const params = await searchParams;
  const siteId = (params.s ?? "").slice(0, 36);
  const site = siteId ? await checkinSiteFor(context.companyId, siteId) : null;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-5 px-4 pt-6 pb-10">
      <header className="flex items-center justify-between gap-3">
        <WorkiaMark />
        <Link
          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          href="/mi"
        >
          Inicio
        </Link>
      </header>

      {site && site.enabled ? (
        <EmployeeCheckin
          code={{
            siteId: site.siteId,
            window: (params.w ?? "").slice(0, 12),
            mac: (params.m ?? "").slice(0, 22),
          }}
          siteName={site.siteName}
        />
      ) : (
        <section className="workia-pass-card space-y-2 px-5 py-4">
          <h1 className="text-lg font-semibold">Checar</h1>
          <p className="text-muted-foreground text-sm" role="alert">
            {site ? CHECKIN_COPY.disabled : CHECKIN_COPY.invalidCode}
          </p>
        </section>
      )}
    </main>
  );
};

export default CheckinPage;
