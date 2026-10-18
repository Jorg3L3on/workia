import { revokeByToken } from "@/lib/mcp/connections";
import { oauthJson, oauthOptions, whenEnabled } from "@/lib/mcp/http";
import { clientIp, hitRateLimit } from "@/lib/mcp/rate-limit";
import { TOKEN_ATTEMPTS_PER_MINUTE } from "@/lib/mcp/config";

// RFC 7009: always 200, whether or not the token existed.
export const POST = whenEnabled(async (request) => {
  const limit = await hitRateLimit(
    `oauth:revoke:${clientIp(request)}`,
    TOKEN_ATTEMPTS_PER_MINUTE,
    60 * 1000,
  );

  if (limit.limited) {
    return oauthJson({ error: "slow_down" }, { status: 429 });
  }

  const type = request.headers.get("content-type") ?? "";
  const body = type.includes("application/json")
    ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
    : Object.fromEntries(
        (await request.formData().catch(() => new FormData())).entries(),
      );
  const token = typeof body.token === "string" ? body.token : null;

  if (token) {
    await revokeByToken(token);
  }

  return oauthJson({});
});

export const OPTIONS = whenEnabled(() => oauthOptions());
