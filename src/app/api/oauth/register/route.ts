import { z } from "zod";

import {
  oauthError,
  oauthJson,
  oauthOptions,
  whenEnabled,
} from "@/lib/mcp/http";
import {
  isAcceptableRedirectUri,
  registerClient,
  registrationSchema,
} from "@/lib/mcp/oauth/clients";
import { clientIp, hitRateLimit } from "@/lib/mcp/rate-limit";

const REGISTRATIONS_PER_HOUR = 20;

// Dynamic Client Registration (RFC 7591), for clients without CIMD.
export const POST = whenEnabled(async (request) => {
  const limit = await hitRateLimit(
    `oauth:register:${clientIp(request)}`,
    REGISTRATIONS_PER_HOUR,
    60 * 60 * 1000,
  );

  if (limit.limited) {
    return oauthError("slow_down", "Demasiados registros desde esta IP.", 429);
  }

  try {
    const input = registrationSchema.parse(await request.json());

    if (!input.redirect_uris.every(isAcceptableRedirectUri)) {
      return oauthError(
        "invalid_redirect_uri",
        "Las redirect_uris deben ser https (o http en localhost) y sin fragmento.",
      );
    }

    const { client, clientSecret } = await registerClient(input);

    return oauthJson(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        response_types: ["code"],
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        ...(clientSecret
          ? { client_secret: clientSecret, client_secret_expires_at: 0 }
          : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return oauthError(
        "invalid_client_metadata",
        "Metadatos de cliente inválidos.",
      );
    }

    throw error;
  }
});

export const OPTIONS = whenEnabled(() => oauthOptions());
