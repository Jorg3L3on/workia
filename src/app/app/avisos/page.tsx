import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ChannelForm } from "@/components/notifications/channel-form";
import { InboxList } from "@/components/notifications/inbox-list";
import { pageTitles } from "@/lib/brand/chrome-copy";
import {
  countUnread,
  listInboxPage,
  listOptOuts,
  userRecipient,
} from "@/lib/notifications";
import {
  markAllUserNotificationsReadAction,
  openUserNotificationAction,
  setUserEmailChannelAction,
} from "@/lib/notifications/actions";
import { requireCompanyPage } from "@/lib/tenant/context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: pageTitles.avisos };

type AvisosPageProps = {
  searchParams: Promise<{ antes?: string }>;
};

/** The HR user's inbox in the active company (W2-08), and their email switch. */
const HrNotificationsPage = async ({ searchParams }: AvisosPageProps) => {
  const session = await requireCompanyPage();
  const { antes } = await searchParams;
  const recipient = userRecipient(session.userId);
  const [page, unread, optOuts] = await Promise.all([
    listInboxPage(session.companyId, recipient, antes),
    countUnread(session.companyId, recipient),
    listOptOuts(session.companyId, recipient),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        description="Contratos por vencer y lo que espera tu decisión en esta empresa."
        title={pageTitles.avisos}
      />
      <InboxList
        firstHref={antes ? "/app/avisos" : null}
        items={page.items}
        markAllAction={markAllUserNotificationsReadAction}
        nextHref={
          page.nextCursor
            ? `/app/avisos?antes=${encodeURIComponent(page.nextCursor)}`
            : null
        }
        openAction={openUserNotificationAction}
        unread={unread}
      />
      <section className="workia-pass-card px-5 py-1">
        <ChannelForm
          action={setUserEmailChannelAction}
          channel="email"
          description="Un correo con cada aviso de esta empresa. Siguen aquí aunque lo desactives."
          enabled={!optOuts.has("email")}
          label="Correo"
        />
      </section>
    </div>
  );
};

export default HrNotificationsPage;
