import {
  authorizationServerMetadata,
  oauthJson,
  oauthOptions,
  whenEnabled,
} from "@/lib/mcp/http";

// RFC 8414. Path-aware variants resolve to the same issuer.
export const GET = whenEnabled((request) =>
  oauthJson(authorizationServerMetadata(request), {
    cache: "public, max-age=3600",
  }),
);

export const OPTIONS = whenEnabled(() => oauthOptions());
