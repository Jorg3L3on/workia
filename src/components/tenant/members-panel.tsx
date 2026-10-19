"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";

import { CompanyField } from "@/components/tenant/company-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/ui/form-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

const AddMemberForm = ({
  roles,
  scope,
}: Pick<MembersPanelProps, "roles" | "scope">) => {
  const [state, action, pending] = useActionState(addMemberAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  useResultToast(state, "Miembro agregado.");

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
    >
      <ScopeFields scope={scope} />
      <div className="space-y-2">
        <Label htmlFor="member-email">Correo de la cuenta</Label>
        <Input
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
      <Button
        type="submit"
        disabled={pending}
        // On /admin/empresas/[id] «Guardar cambios» is the view's primary.
        variant={scope.kind === "platform" ? "secondary" : "primary"}
      >
        Agregar miembro
      </Button>
      {state.error ? (
        <p role="alert" className="text-destructive text-sm sm:col-span-3">
          {state.error}
        </p>
      ) : null}
    </form>
  );
};

const MemberRowActions = ({
  member,
  roles,
  scope,
}: {
  member: MembersPanelMember;
  roles: MembersPanelProps["roles"];
  scope: Scope;
}) => {
  const [roleState, roleAction, rolePending] = useActionState(
    changeMemberRoleAction,
    {},
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeMemberAction,
    {},
  );

  useResultToast(roleState, "Rol actualizado.");
  useResultToast(revokeState, "Acceso revocado.");

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <form action={roleAction} className="flex items-center gap-2">
        <ScopeFields scope={scope} />
        <input type="hidden" name="membershipId" value={member.id} />
        <FormSelect
          aria-label={`Rol de ${member.name}`}
          name="roleSlug"
          defaultValue={member.roleSlug}
          options={roles.map((role) => ({
            value: role.slug,
            label: role.name,
          }))}
          triggerClassName="h-8 w-36"
          variant="field"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={rolePending}
        >
          Cambiar rol
        </Button>
      </form>
      <form action={revokeAction}>
        <ScopeFields scope={scope} />
        <input type="hidden" name="membershipId" value={member.id} />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={revokePending}
        >
          Revocar acceso
        </Button>
      </form>
    </div>
  );
};

export const MembersPanel = ({
  members,
  roles,
  canManage,
  currentUserId,
  scope,
}: MembersPanelProps) => (
  <div className="flex flex-col gap-4">
    {canManage ? <AddMemberForm roles={roles} scope={scope} /> : null}

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Persona</TableHead>
          <TableHead>Rol</TableHead>
          <TableHead>Estado</TableHead>
          {canManage ? (
            <TableHead className="text-right">Acciones</TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => {
          const isSelf = member.userId === currentUserId;
          // Company admins change neither their own access nor a role they
          // cannot assign (super_admin); the platform can change anything.
          const editable =
            canManage &&
            member.status === "activa" &&
            (scope.kind === "platform" ||
              (!isSelf && roles.some((role) => role.slug === member.roleSlug)));

          return (
            <TableRow key={member.id} data-testid="member-row">
              <TableCell>
                <div className="font-medium">
                  {member.name}
                  {isSelf ? (
                    <span className="text-muted-foreground"> (tú)</span>
                  ) : null}
                </div>
                <div className="text-muted-foreground text-xs">
                  {member.email}
                </div>
              </TableCell>
              <TableCell>{member.roleName}</TableCell>
              <TableCell>
                <Badge tone={toneFor("membership", member.status)}>
                  {member.status === "activa" ? "Activo" : "Revocado"}
                </Badge>
              </TableCell>
              {canManage ? (
                <TableCell className="text-right">
                  {editable ? (
                    <MemberRowActions
                      member={member}
                      roles={roles}
                      scope={scope}
                    />
                  ) : member.status === "revocada" ? (
                    <span className="text-muted-foreground text-xs">
                      Agrégalo de nuevo para devolverle el acceso.
                    </span>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  </div>
);
