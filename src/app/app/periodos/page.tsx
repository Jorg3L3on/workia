import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { PayPeriodsTable } from "@/components/pay-periods/pay-periods-table";
import { Button } from "@/components/ui/button";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { isoToday } from "@/lib/format/date";
import { listPayPeriods } from "@/lib/pay-periods";
import { requirePayPeriodsRead } from "@/lib/pay-periods/auth";
import { PAY_PERIOD_COPY } from "@/lib/pay-periods/copy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.periodos,
};

type PeriodosPageProps = {
  searchParams: Promise<{ desde?: string }>;
};

/** Periodos de pago (W2-15): the quincenas, newest first, 12 per page. */
const PeriodosPage = async ({ searchParams }: PeriodosPageProps) => {
  const session = await requirePayPeriodsRead();
  const { desde } = await searchParams;
  const page = await listPayPeriods(session.companyId, {
    today: isoToday(),
    cursor: desde ?? null,
    limit: 12,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={PAY_PERIOD_COPY.description}
        title={PAY_PERIOD_COPY.title}
      />
      <PayPeriodsTable
        items={page.items.map((item) => ({
          ...item,
          closedAt: item.closedAt ? item.closedAt.toISOString() : null,
        }))}
      />
      {page.next ? (
        <div>
          <Button asChild variant="secondary">
            <Link href={`/app/periodos?desde=${page.next}`}>
              {PAY_PERIOD_COPY.morePeriods}
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default PeriodosPage;
