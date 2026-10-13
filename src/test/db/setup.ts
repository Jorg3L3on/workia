import { vi } from "vitest";

// Database tests run server code outside Next.js: Auth.js returns the session a
// test chose (actAs), and navigation helpers throw a recognizable error.
vi.mock("@/auth", async () => {
  const { sessionState } = await import("@/test/idor/session-state");

  return {
    auth: async () => sessionState.current,
    unstable_update: async (data: { activeCompanyId?: string }) => {
      if (sessionState.current && data.activeCompanyId) {
        sessionState.current = {
          ...sessionState.current,
          activeCompanyId: data.activeCompanyId,
        };
      }
      return sessionState.current;
    },
    signIn: vi.fn(),
    signOut: vi.fn(),
    handlers: {},
  };
});

vi.mock("next/navigation", async () => {
  const { NavigationThrow } = await import("@/test/idor/session-state");

  return {
    redirect: (url: string) => {
      throw new NavigationThrow("redirect", url);
    },
    notFound: () => {
      throw new NavigationThrow("notFound");
    },
    forbidden: () => {
      throw new NavigationThrow("forbidden");
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
