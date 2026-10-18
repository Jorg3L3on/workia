"use server";

import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

import { NEW_CONNECTIONS_PER_HOUR, publicOrigin } from "../config";
import { countRecentConnections, createAuthCode } from "../connections";
import { currentRequest } from "../request-origin";
import {
  CONSENT_PARAMS,
  callbackUrl,
  loadConsentRequest,
  resolveGrantedScopes,
  type ConsentParams,
} from "./consent";

export type ConsentActionState = { error?: string };

const paramsFrom = (formData: FormData): ConsentParams =>
  Object.fromEntries(
    CONSENT_PARAMS.flatMap((name) => {
      const value = formData.get(name);
      return typeof value === "string" && value !== "" ? [[name, value]] : [];
    }),
  );

/**
 * The person approves the connection: everything is validated again on the
 * server (session, client, redirect URI, membership and role in the chosen
 * company), the scopes are cut to what they may grant, and the client gets a
 * one-time code bound to that company.
 */
export const approveConsentAction = async (
  _state: ConsentActionState,
  formData: FormData,
): Promise<ConsentActionState> => {
  const session = await getSession();
  const userId = session?.user?.id;

  if (!userId) {
    return { error: "Tu sesión terminó. Vuelve a iniciar sesión." };
  }

  const request = await currentRequest("/oauth/consent");
  const loaded = await loadConsentRequest(
    paramsFrom(formData),
    userId,
    request,
  );

  if (!loaded.ok) {
    return { error: loaded.error };
  }

  const companyId = formData.get("company_id");
  const company = loaded.request.companies.find(
    (candidate) => candidate.membership.companyId === companyId,
  );

  // A company the person does not belong to looks the same as a missing one.
  if (!company || !company.canConnect) {
    return { error: "No puedes conectar asistentes en esa empresa." };
  }

  // 10 new connections per person per hour (spec §7), counted on the rows.
  const since = new Date(Date.now() - 60 * 60 * 1000);

  if (
    (await countRecentConnections(
      company.membership.companyId,
      userId,
      since,
    )) >= NEW_CONNECTIONS_PER_HOUR
  ) {
    return {
      error:
        "Creaste demasiadas conexiones en la última hora. Intenta más tarde.",
    };
  }

  const scopes = resolveGrantedScopes(
    formData.getAll("scope_choice").map(String),
    company,
    loaded.request.requested,
  );
  const code = await createAuthCode(company.membership.companyId, {
    userId,
    clientId: loaded.request.client.clientId,
    redirectUri: loaded.request.redirectUri,
    scopes,
    codeChallenge: loaded.request.codeChallenge,
    resource: loaded.request.resource,
  });

  logger.info(
    {
      event: "mcp.oauth.consent",
      companyId: company.membership.companyId,
      client: loaded.request.client.clientName,
      scopes,
    },
    "mcp.oauth.consent",
  );

  redirect(
    callbackUrl(loaded.request.redirectUri, publicOrigin(request), {
      code,
      state: loaded.request.state,
    }),
  );
};

/** The person declines: the client gets access_denied and nothing is stored. */
export const denyConsentAction = async (formData: FormData) => {
  const session = await getSession();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const request = await currentRequest("/oauth/consent");
  const loaded = await loadConsentRequest(
    paramsFrom(formData),
    session.user.id,
    request,
  );

  if (!loaded.ok) {
    redirect("/app");
  }

  redirect(
    callbackUrl(loaded.request.redirectUri, publicOrigin(request), {
      error: "access_denied",
      state: loaded.request.state,
    }),
  );
};
