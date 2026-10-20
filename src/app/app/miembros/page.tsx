import type { Metadata } from "next";
import { forbidden } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import {
  AddMemberSheet,
  MembersPanel,
} from "@/components/tenant/members-panel";
import { pageTitles } from "@/lib/brand/chrome-copy";
import { requireCompanyPage } from "@/lib/tenant/context";
import {
  COMPANY_ASSIGNABLE_ROLES,
  listCompanyMembers,
  listRoles,
} from "@/lib/tenant/members";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: pageTitles.miembros,
};

/** Who has access to the active company, with which role. */
const MiembrosPage = async () => {
  const session = await requireCompanyPage();

  if (!session.permissions.has("members:read")) {
    forbidden();
  }

  const [members, allRoles] = await Promise.all([
    listCompanyMembers(session.companyId),
    listRoles(),
  ]);
  const roles = allRoles.filter((role) =>
    (COMPANY_ASSIGNABLE_ROLES as readonly string[]).includes(role.slug),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description={`Quién tiene acceso a ${session.membership.companyName} y con qué rol.`}
        primary={
          session.permissions.has("members:manage") ? (
            <AddMemberSheet roles={roles} scope={{ kind: "company" }} />
          ) : null
        }
        title="Miembros"
      />
      <section className="workia-pass-card p-5">
        <MembersPanel
          members={members}
          roles={roles}
          canManage={session.permissions.has("members:manage")}
          currentUserId={session.userId}
          scope={{ kind: "company" }}
        />
      </section>
    </div>
  );
};

export default MiembrosPage;
