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

export const getSafeSignOutRedirect = (redirectTo: string | null): string => {
  if (
    !redirectTo ||
    !redirectTo.startsWith("/") ||
    redirectTo.startsWith("//")
  ) {
    return "/";
  }

  return redirectTo;
};
