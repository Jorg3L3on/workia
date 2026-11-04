import type { Metadata } from "next";
import Link from "next/link";

import { ChannelForm } from "@/components/notifications/channel-form";
import { InboxList } from "@/components/notifications/inbox-list";
import { PushToggle } from "@/components/notifications/push-toggle";
import { requireEmployeeContext } from "@/lib/employee-accounts/session";
import {
  countUnread,
  listInboxPage,
  listOptOuts,
  personRecipient,
} from "@/lib/notifications";
import {
  markAllEmployeeNotificationsReadAction,
  openEmployeeNotificationAction,
  setEmployeeChannelAction,
} from "@/lib/notifications/actions";
import { pushPublicKey } from "@/lib/notifications/push";

export const metadata: Metadata = { title: "Avisos" };

type AvisosPageProps = {
  searchParams: Promise<{ antes?: string }>;
};

/**
 * The employee's inbox (W2-08): every message stays here, whatever its email
 * or push did. Below it, email on or off and push for this phone.
 */
const EmployeeNotificationsPage = async ({ searchParams }: AvisosPageProps) => {
  const context = await requireEmployeeContext();
  const { antes } = await searchParams;
  const recipient = personRecipient(context.personId);
  const [page, unread, optOuts] = await Promise.all([
    listInboxPage(context.companyId, recipient, antes),
    countUnread(context.companyId, recipient),
    listOptOuts(context.companyId, recipient),
  ]);
  const publicKey = pushPublicKey();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-5 px-4 pt-6 pb-10">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Avisos</h1>
        <Link className="text-primary text-sm underline" href="/mi">
          Volver al inicio
        </Link>
      </header>

      <InboxList
        firstHref={antes ? "/mi/avisos" : null}
        items={page.items}
        markAllAction={markAllEmployeeNotificationsReadAction}
        nextHref={
          page.nextCursor
            ? `/mi/avisos?antes=${encodeURIComponent(page.nextCursor)}`
            : null
        }
        openAction={openEmployeeNotificationAction}
        unread={unread}
      />

      <section
        aria-labelledby="avisos-canales"
        className="workia-pass-card flex flex-col px-5 py-3"
      >
        <h2 className="pt-1 text-base font-semibold" id="avisos-canales">
          Cómo te avisamos
        </h2>
        <div className="divide-border flex flex-col divide-y">
          <ChannelForm
            action={setEmployeeChannelAction}
            channel="email"
            description="Te mandamos un correo con cada aviso."
            enabled={!optOuts.has("email")}
            label="Correo"
          />
          {publicKey ? <PushToggle publicKey={publicKey} /> : null}
        </div>
        <p className="text-muted-foreground pb-1 text-xs">
          Los avisos siempre quedan en esta página, aunque desactives el correo
          o el teléfono.
        </p>
      </section>
    </main>
  );
};

export default EmployeeNotificationsPage;
