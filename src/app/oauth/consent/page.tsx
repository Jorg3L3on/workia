import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2Icon, ChevronRightIcon } from "lucide-react";

import { LoginStage } from "@/components/auth/login-stage";
import { WorkiaMark } from "@/components/brand/workia-mark";
import { ConsentForm } from "@/components/mcp/consent-form";
import { companyCopy } from "@/lib/brand/chrome-copy";
import { getSession } from "@/lib/auth/session";
import { isMcpEnabled } from "@/lib/mcp/config";
import { currentRequest } from "@/lib/mcp/request-origin";
import {
  CONSENT_PARAMS,
  loadConsentRequest,
  type ConsentParams,
} from "@/lib/mcp/oauth/consent";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Conectar asistente",
};

type ConsentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const Badge = ({
  stamp,
  title,
  description,
  children,
}: {
  stamp?: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) => (
  <LoginStage>
    <div className="login-badge-shadow w-full">
      <div className="login-badge" data-testid="oauth-consent">
        <div className="px-[30px] pt-2 pb-1 max-[400px]:px-[22px]">
          <div className="mb-[22px] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <WorkiaMark />
              <span className="text-[17px] font-bold tracking-[-0.01em] text-[color:var(--login-ink)]">
                workia
              </span>
            </div>
            <span
              className="rounded border border-[color:var(--login-line)] px-2.5 py-1 font-mono text-[11px] tracking-[0.05em] text-[color:var(--login-ink-faint)]"
              aria-hidden
            >
              {stamp ?? "MCP · OAUTH"}
            </span>
          </div>
          <h1 className="mb-1.5 text-[22px] font-semibold tracking-[-0.015em] text-[color:var(--login-ink)] sm:text-[25px]">
            {title}
          </h1>
          <p className="mb-[22px] text-[13.5px] leading-normal text-[color:var(--login-ink-muted)]">
            {description}
          </p>
          {children}
        </div>
      </div>
    </div>
  </LoginStage>
);

/**
 * OAuth consent (spec §6, addendum §1): needs a Workia session, then the person
 * picks one company (the connection is bound to it) and the scopes their role
 * there allows.
 */
export default async function ConsentPage({ searchParams }: ConsentPageProps) {
  const query = await searchParams;
  const params: ConsentParams = Object.fromEntries(
    CONSENT_PARAMS.flatMap((name) => {
      const value = query[name];
      return typeof value === "string" ? [[name, value]] : [];
    }),
  );
  const search = new URLSearchParams(
    Object.entries(query).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );

  if (!isMcpEnabled()) {
    return (
      <Badge
        title="Conexiones deshabilitadas"
        description="El conector de asistentes de Workia está apagado."
      />
    );
  }

  const session = await getSession();

  if (!session?.user?.id) {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/oauth/consent?${search}`)}`,
    );
  }

  const loaded = await loadConsentRequest(
    params,
    session.user.id,
    await currentRequest("/oauth/consent"),
  );

  if (!loaded.ok) {
    return (
      <Badge
        stamp="SOLICITUD INVÁLIDA"
        title="No se puede conectar"
        description={loaded.error}
      />
    );
  }

  const { request } = loaded;
  const clientName = request.client.clientName;
  const connectable = request.companies.filter((company) => company.canConnect);

  if (request.companies.length === 0) {
    return (
      <Badge
        stamp={companyCopy.noCompanyStamp}
        title={companyCopy.noCompanyTitle}
        description={`${clientName} pide acceso a Workia, pero tu cuenta no tiene acceso a ninguna empresa.`}
      />
    );
  }

  if (connectable.length === 0) {
    return (
      <Badge
        stamp="SIN PERMISO"
        title="No puedes conectar asistentes"
        description="Tu rol no permite conectar asistentes en tus empresas. Pide a la persona administradora el permiso «Conectar asistentes»."
      />
    );
  }

  const chosenId =
    typeof query.company === "string"
      ? query.company
      : connectable.length === 1
        ? connectable[0].membership.companyId
        : null;
  const chosen = connectable.find(
    (company) => company.membership.companyId === chosenId,
  );

  if (!chosen) {
    return (
      <Badge
        title={`¿Con qué empresa se conecta ${clientName}?`}
        description="La conexión queda ligada a una sola empresa. Para usar otra, conecta de nuevo."
      >
        <div className="flex flex-col gap-2">
          {connectable.map((company) => {
            const next = new URLSearchParams(search);
            next.set("company", company.membership.companyId);

            return (
              <Link
                key={company.membership.companyId}
                href={`/oauth/consent?${next}`}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-[color:var(--login-line)] px-4 py-3 text-left transition-colors hover:bg-[color:var(--login-line)]/40"
              >
                <Building2Icon
                  className="size-5 shrink-0 text-[color:var(--login-ink-muted)]"
                  aria-hidden
                />
                <span className="grid flex-1">
                  <span className="text-[15px] font-semibold text-[color:var(--login-ink)]">
                    {company.membership.companyName}
                  </span>
                  <span className="text-[12.5px] text-[color:var(--login-ink-muted)]">
                    {company.membership.roleName}
                  </span>
                </span>
                <ChevronRightIcon
                  className="size-4 text-[color:var(--login-ink-faint)]"
                  aria-hidden
                />
              </Link>
            );
          })}
        </div>
      </Badge>
    );
  }

  return (
    <Badge
      title={`${clientName} quiere acceder a Workia`}
      description={`Como ${session.user.email ?? "tú"} en ${chosen.membership.companyName} (${chosen.membership.roleName}). Puedes revocar el acceso cuando quieras en Conexiones.`}
    >
      <ConsentForm
        params={params as Record<string, string>}
        companyId={chosen.membership.companyId}
        offerable={chosen.offerable}
        requested={request.requested}
        isChatgpt={request.isChatgpt}
      />
    </Badge>
  );
}
