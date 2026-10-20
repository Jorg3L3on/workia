"use client";

import { UserCogIcon, UserPlusIcon, UserXIcon } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FormSheet } from "@/components/layout/form-sheet";
import { CompanyField } from "@/components/tenant/company-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DataTable,
  RowMenu,
  type DataTableColumn,
} from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addMemberAction,
  changeMemberRoleAction,
  revokeMemberAction,
  type AdminActionState,
} from "@/lib/tenant/admin-actions";
import { toneFor } from "@/lib/ui/status-tone";

export type MembersPanelMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  roleSlug: string;
  roleName: string;
  status: "activa" | "revocada";
  isDefault: boolean;
};

type Scope =
  { kind: "company" } | { kind: "platform"; targetCompanyId: string };

type MembersPanelProps = {
  members: MembersPanelMember[];
  roles: { slug: string; name: string }[];
  canManage: boolean;
  currentUserId: string;
  scope: Scope;
};

/** Who the action acts for: the active company (with its guard field) or the platform. */
const ScopeFields = ({ scope }: { scope: Scope }) =>
  scope.kind === "platform" ? (
    <>
      <input type="hidden" name="scope" value="platform" />
      <input
        type="hidden"
        name="targetCompanyId"
        value={scope.targetCompanyId}
      />
    </>
  ) : (
    <CompanyField />
  );

/** Toast once per result. */
const useResultToast = (state: AdminActionState, success: string) => {
  const last = useRef<AdminActionState | null>(null);

  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.error) toast.error(state.error);
    if (state.ok) toast.success(success);
  }, [state, success]);
};

/** «Agregar miembro»: the header's primary, opening a Sheet. */
export const AddMemberSheet = ({
  roles,
  scope,
}: Pick<MembersPanelProps, "roles" | "scope">) => {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (prev: AdminActionState, formData: FormData) => {
      const next = await addMemberAction(prev, formData);
      if (next.ok) setOpen(false);
      return next;
    },
    {},
  );

  useResultToast(state, "Miembro agregado.");

  return (
    <FormSheet
      description="Si aún no tiene cuenta, se crea con su correo y entra con Google."
      formId="agregar-miembro"
      onOpenChange={setOpen}
      open={open}
      pending={pending}
      submitLabel="Agregar"
      title="Agregar miembro"
      triggerIcon={UserPlusIcon}
      triggerLabel="Agregar miembro"
    >
      <form action={action} className="space-y-4" id="agregar-miembro">
        <ScopeFields scope={scope} />
        <div className="space-y-2">
          <Label htmlFor="member-email">Correo</Label>
          <Input
            autoFocus
            id="member-email"
            name="email"
            type="email"
            placeholder="nombre@empresa.com"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="member-role">Rol</Label>
          <FormSelect
            id="member-role"
            name="roleSlug"
            defaultValue="viewer"
            options={roles.map((role) => ({
              value: role.slug,
              label: role.name,
            }))}
            required
            variant="field"
          />
        </div>
        {state.error ? (
          <p role="alert" className="text-destructive text-sm">
            {state.error}
          </p>
        ) : null}
      </form>
    </FormSheet>
  );
};

const ChangeRoleDialog = ({
  member,
  roles,
  scope,
  onOpenChange,
}: {
  member: MembersPanelMember;
  roles: MembersPanelProps["roles"];
  scope: Scope;
  onOpenChange: (open: boolean) => void;
}) => {
  const [state, action, pending] = useActionState(changeMemberRoleAction, {});

  useResultToast(state, "Rol actualizado.");

  useEffect(() => {
    if (state.ok) onOpenChange(false);
  }, [state, onOpenChange]);

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Cambiar rol</DialogTitle>
          <DialogDescription>
            {member.name} · {member.email}
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <ScopeFields scope={scope} />
          <input type="hidden" name="membershipId" value={member.id} />
          <div className="space-y-2">
            <Label htmlFor={`role-${member.id}`}>Rol</Label>
            <FormSelect
              defaultValue={member.roleSlug}
              id={`role-${member.id}`}
              name="roleSlug"
              options={roles.map((role) => ({
                value: role.slug,
                label: role.name,
              }))}
              variant="field"
            />
          </div>
          {state.error ? (
            <p role="alert" className="text-destructive text-sm">
              {state.error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
            <Button disabled={pending} type="submit">
              Guardar rol
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const MemberRowMenu = ({
  member,
  roles,
  scope,
}: {
  member: MembersPanelMember;
  roles: MembersPanelProps["roles"];
  scope: Scope;
}) => {
  const [changingRole, setChangingRole] = useState(false);
  const [revokeState, revokeAction] = useActionState(revokeMemberAction, {});

  useResultToast(revokeState, "Acceso revocado.");

  return (
    <>
      <RowMenu
        actions={[
          {
            label: "Cambiar rol",
            icon: UserCogIcon,
            onSelect: () => setChangingRole(true),
          },
          {
            label: "Revocar acceso",
            icon: UserXIcon,
            destructive: true,
            action: revokeAction,
            fields: (
              <>
                <ScopeFields scope={scope} />
                <input type="hidden" name="membershipId" value={member.id} />
              </>
            ),
            confirm: {
              title: `¿Revocar el acceso de ${member.name}?`,
              description:
                "Deja de ver esta empresa al instante. Para devolverle el acceso, agrégalo de nuevo.",
              confirmLabel: "Revocar acceso",
            },
          },
        ]}
        label={`Acciones de ${member.name}`}
      />
      {changingRole ? (
        <ChangeRoleDialog
          member={member}
          onOpenChange={setChangingRole}
          roles={roles}
          scope={scope}
        />
      ) : null}
    </>
  );
};

const MemberStatus = ({ member }: { member: MembersPanelMember }) => (
  <Badge tone={toneFor("membership", member.status)}>
    {member.status === "activa" ? "Activo" : "Revocado"}
  </Badge>
);

const MemberName = ({
  member,
  isSelf,
}: {
  member: MembersPanelMember;
  isSelf: boolean;
}) => (
  <div className="min-w-0">
    <div className="text-foreground truncate">
      {member.name}
      {isSelf ? <span className="text-muted-foreground"> (tú)</span> : null}
    </div>
    <div className="text-muted-foreground truncate text-xs">{member.email}</div>
  </div>
);

export const MembersPanel = ({
  members,
  roles,
  canManage,
  currentUserId,
  scope,
}: MembersPanelProps) => {
  // Company admins change neither their own access nor a role they cannot
  // assign (super_admin); the platform can change anything.
  const editable = (member: MembersPanelMember) =>
    canManage &&
    member.status === "activa" &&
    (scope.kind === "platform" ||
      (member.userId !== currentUserId &&
        roles.some((role) => role.slug === member.roleSlug)));

  const columns: DataTableColumn<MembersPanelMember>[] = [
    {
      id: "name",
      header: "Persona",
      accessor: (member) => `${member.name} ${member.email}`,
      cell: (member) => (
        <MemberName isSelf={member.userId === currentUserId} member={member} />
      ),
      cellClassName: "max-w-72",
    },
    {
      id: "role",
      header: "Rol",
      accessor: (member) => member.roleName,
      variant: "muted",
    },
    {
      id: "status",
      header: "Estado",
      accessor: (member) => member.status,
      cell: (member) => <MemberStatus member={member} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={members}
      emptyTitle="Sin miembros todavía"
      getRowId={(member) => member.id}
      layout="inset"
      mobileCard={(member) => ({
        title: (
          <MemberName
            isSelf={member.userId === currentUserId}
            member={member}
          />
        ),
        subtitle: member.roleName,
        badge: <MemberStatus member={member} />,
      })}
      rowMenu={
        canManage
          ? (member) =>
              editable(member) ? (
                <MemberRowMenu member={member} roles={roles} scope={scope} />
              ) : null
          : undefined
      }
      rowTestId="member-row"
      searchPlaceholder="Buscar por nombre o correo"
    />
  );
};
