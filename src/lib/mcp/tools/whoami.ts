import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { formatDateMx, formatDateTimeMx } from "@/lib/format/date";
import { listActiveMemberships } from "@/lib/tenant/memberships";

import { notFound } from "../errors";
import { defineTool, readAnnotations } from "../run-tool";
import { effectivePermissions } from "../scopes";

const output = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
  }),
  company: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
  role: z.object({ slug: z.string(), name: z.string() }),
  roles: z.array(z.string()),
  permissions: z
    .array(z.string())
    .describe(
      "Permisos efectivos: los del rol que los scopes de la conexión cubren.",
    ),
  scopes: z.array(z.string()),
  pii_unmasked: z.boolean(),
  connection: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(["oauth", "pat"]),
    client: z.string(),
    is_chatgpt: z.boolean(),
    expires_at: z.string(),
    expires_at_mx: z.string(),
  }),
  today: z.string(),
  today_mx: z.string(),
});

export const whoamiTool = defineTool({
  name: "whoami",
  title: "Quién soy",
  description:
    "Devuelve la persona usuaria de esta conexión, su empresa y rol en Workia, los permisos que puede usar por aquí (rol ∩ scopes), los scopes, la conexión con su vencimiento y la fecha de hoy en México. Úsala primero para saber qué puedes hacer.",
  kind: "read",
  scope: "read",
  permission: "people:read",
  input: z.object({}),
  output,
  annotations: readAnnotations("Quién soy"),
  handler: async (_args, ctx) => {
    const [[user], memberships] = await Promise.all([
      db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, ctx.userId))
        .limit(1),
      listActiveMemberships(ctx.userId),
    ]);
    const membership = memberships.find(
      (candidate) => candidate.companyId === ctx.companyId,
    );

    if (!user || !membership) {
      throw notFound("La persona usuaria");
    }

    const scopes = [...ctx.scopes];

    return {
      user,
      company: {
        id: membership.companyId,
        name: membership.companyName,
        slug: membership.companySlug,
      },
      role: { slug: membership.roleSlug, name: membership.roleName },
      roles: [membership.roleSlug],
      permissions: effectivePermissions(ctx.permissions, scopes),
      scopes,
      pii_unmasked: ctx.piiUnmasked,
      connection: {
        id: ctx.auth.connectionId,
        name: ctx.auth.name,
        kind: ctx.auth.kind,
        client: ctx.auth.clientName,
        is_chatgpt: ctx.auth.isChatgpt,
        expires_at: ctx.auth.expiresAt.toISOString(),
        expires_at_mx: formatDateTimeMx(ctx.auth.expiresAt),
      },
      today: ctx.today,
      today_mx: formatDateMx(ctx.today),
    };
  },
});
