const hostsMatch = (candidate: string, host: string) => {
  try {
    return new URL(candidate).host === host;
  } catch {
    return false;
  }
};

export const isSameOriginSignOutRequest = (request: Request): boolean => {
  const host = request.headers.get("host");

  if (!host) {
    return false;
  }

  const origin = request.headers.get("origin");

  if (origin) {
    return hostsMatch(origin, host);
  }

  const referer = request.headers.get("referer");

  if (referer) {
    return hostsMatch(referer, host);
  }

  return false;
};

const ALLOWED_SIGN_OUT_REDIRECTS = new Set(["/login", "/"]);

export const getSafeSignOutRedirect = (redirectTo: string | null): string => {
  if (redirectTo && ALLOWED_SIGN_OUT_REDIRECTS.has(redirectTo)) {
    return redirectTo;
  }

  return "/login";
};
