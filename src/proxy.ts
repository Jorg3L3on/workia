import { auth } from "@/auth";

export default auth((request) => {
  const { nextUrl } = request;
  const isLoggedIn = Boolean(request.auth);
  const pathname = nextUrl.pathname;

  const isProtectedRoute =
    pathname.startsWith("/admin") || pathname.startsWith("/app");
  const isAuthRoute = pathname.startsWith("/login");

  if (isAuthRoute && isLoggedIn) {
    return Response.redirect(new URL("/app", nextUrl));
  }

  if (isProtectedRoute && !isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return Response.redirect(loginUrl);
  }

  return undefined;
});

export const config = {
  matcher: ["/admin/:path*", "/app/:path*", "/login"],
};
