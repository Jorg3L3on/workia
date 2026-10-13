/** The session the mocked `auth()` returns; tests switch users with actAs(). */
export type TestSession = {
  user: { id: string; email: string; name: string };
  activeCompanyId: string | null;
  expires: string;
};

export const sessionState: { current: TestSession | null } = { current: null };

export const actAs = (
  user: { id: string; email: string } | null,
  activeCompanyId: string | null = null,
) => {
  sessionState.current = user
    ? {
        user: { id: user.id, email: user.email, name: user.email },
        activeCompanyId,
        expires: new Date(Date.now() + 3_600_000).toISOString(),
      }
    : null;
};

/** Thrown by the mocked next/navigation helpers, so tests can assert where a page or action went. */
export class NavigationThrow extends Error {
  constructor(
    public readonly kind: "redirect" | "notFound" | "forbidden",
    public readonly url?: string,
  ) {
    super(`${kind}${url ? ` ${url}` : ""}`);
    this.name = "NavigationThrow";
  }
}
