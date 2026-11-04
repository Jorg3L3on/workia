import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { RunAlertsButton } from "@/components/lft-alerts/run-alerts-button";
import { Badge } from "@/components/ui/badge";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { formatDateMx, formatDateTimeMx } from "@/lib/format/date";
import {
  LFT_ALERT_KIND_LABEL,
  LFT_ALERT_PERMISSIONS,
  LFT_ALERTS_COPY,
  listLftAlerts,
  readableAlertKinds,
  type LftAlertLogItem,
} from "@/lib/lft-alerts";
import { runLftAlertsNowAction } from "@/lib/lft-alerts/actions";
import { requireCompanyPage } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: pageTitles.alertas };

type AlertasPageProps = {
  searchParams: Promise<{ antes?: string }>;
};

const detailOf = (item: LftAlertLogItem) => {
  const details = item.details as Record<string, string | number | undefined>;

  switch (item.kind) {
    case "absence_warning":
    case "absence_threshold":
      return `${details.count} faltas sin justificar del ${formatDateMx(String(details.from))} al ${formatDateMx(String(details.to))}`;
    case "contract_ending":
      return `El contrato termina el ${formatDateMx(item.dueOn)}`;
    case "document_expiring":
      return `${details.document ?? "Documento"} vence el ${formatDateMx(item.dueOn)}`;
  }
};

/**
 * The LFT alert log of the active company (W2-19): what Workia sent to HR
 * and the managers, newest first, only the kinds the reader may see.
 */
const LftAlertsPage = async ({ searchParams }: AlertasPageProps) => {
  const session = await requireCompanyPage();
  const { antes } = await searchParams;
  const kinds = readableAlertKinds(session.permissions);
  const canRun = Object.values(LFT_ALERT_PERMISSIONS).some(({ notify }) =>
    session.permissions.has(notify),
  );
  const page = await listLftAlerts(session.companyId, {
    kinds,
    cursor: antes,
  });
  const showsAbsences = kinds.includes("absence_warning");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        primary={
          canRun ? <RunAlertsButton action={runLftAlertsNowAction} /> : null
        }
        description={LFT_ALERTS_COPY.description}
        title={pageTitles.alertas}
      />

      {showsAbsences ? (
        <p className="text-muted-foreground text-sm">{LFT_ALERTS_COPY.rule}</p>
      ) : null}

      {antes ? (
        <Link className="text-primary text-sm underline" href="/app/alertas">
          {LFT_ALERTS_COPY.newest}
        </Link>
      ) : null}

      {page.items.length === 0 ? (
        <section className="workia-pass-card flex flex-col gap-1 px-5 py-4">
          <h2 className="text-base font-semibold">
            {LFT_ALERTS_COPY.emptyTitle}
          </h2>
          <p className="text-muted-foreground text-sm">
            {LFT_ALERTS_COPY.emptyDescription}
          </p>
        </section>
      ) : (
        <ul
          className="divide-border flex flex-col divide-y rounded-xl border"
          data-testid="lft-alerts-log"
        >
          {page.items.map((item) => (
            <li
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              key={item.id}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="text-sm font-medium underline-offset-2 hover:underline"
                    href={`/app/personas/${item.personId}`}
                  >
                    {item.personName}
                  </Link>
                  <Badge
                    tone={
                      item.kind === "absence_threshold" ? "danger" : "warning"
                    }
                  >
                    {LFT_ALERT_KIND_LABEL[item.kind]}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-sm">
                  {detailOf(item)}
                </p>
              </div>
              <div className="text-muted-foreground flex shrink-0 flex-col text-xs sm:items-end">
                <span>{formatDateTimeMx(item.createdAt)}</span>
                <span>
                  {LFT_ALERTS_COPY.recipients(
                    item.hrRecipients,
                    item.managerNotified,
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <Link
          className="text-primary text-sm underline"
          href={`/app/alertas?antes=${encodeURIComponent(page.nextCursor)}`}
        >
          {LFT_ALERTS_COPY.older}
        </Link>
      ) : null}
    </div>
  );
};

export default LftAlertsPage;
