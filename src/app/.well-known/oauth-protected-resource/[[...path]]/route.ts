import {
  oauthJson,
  oauthOptions,
  protectedResourceMetadata,
  whenEnabled,
} from "@/lib/mcp/http";

// RFC 9728. Also answers path-aware lookups (/.well-known/oauth-protected-resource/api/mcp).
export const GET = whenEnabled((request) =>
  oauthJson(protectedResourceMetadata(request), {
    cache: "public, max-age=3600",
  }),
);

export const OPTIONS = whenEnabled(() => oauthOptions());
