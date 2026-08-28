import { beforeEach, describe, expect, it, vi } from "vitest";

const { signOutMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
  signOut: signOutMock,
}));

import { POST } from "@/app/api/auth/sign-out/route";

describe("POST /api/auth/sign-out", () => {
  beforeEach(() => {
    signOutMock.mockReset();
  });
  it("redirects to / and clears secure session cookies for same-origin POST", async () => {
    signOutMock.mockResolvedValue(undefined);

    const formData = new FormData();
    formData.set("redirectTo", "/");

    const request = new Request("https://workia.local/api/auth/sign-out", {
      method: "POST",
      headers: {
        host: "workia.local",
        origin: "https://workia.local",
      },
      body: formData,
    });

    const response = await POST(request);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://workia.local/");

    const secureSession = response.cookies
      .getAll()
      .find((entry) => entry.name === "__Secure-authjs.session-token");

    expect(secureSession?.value).toBe("");
    expect(secureSession?.maxAge).toBe(0);
    expect(secureSession?.secure).toBe(true);
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false });
  });

  it("rejects cross-origin POST with 403", async () => {
    const formData = new FormData();
    formData.set("redirectTo", "/");

    const request = new Request("https://workia.local/api/auth/sign-out", {
      method: "POST",
      headers: {
        host: "workia.local",
        origin: "https://evil.example",
      },
      body: formData,
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("falls back to / when redirectTo is unsafe", async () => {
    signOutMock.mockResolvedValue(undefined);

    const formData = new FormData();
    formData.set("redirectTo", "//evil.example");

    const request = new Request("https://workia.local/api/auth/sign-out", {
      method: "POST",
      headers: {
        host: "workia.local",
        origin: "https://workia.local",
      },
      body: formData,
    });

    const response = await POST(request);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://workia.local/");
  });

  it("still clears cookies when Auth.js signOut throws", async () => {
    signOutMock.mockRejectedValue(new Error("auth signOut failed"));

    const formData = new FormData();
    formData.set("redirectTo", "/");

    const request = new Request("https://workia.local/api/auth/sign-out", {
      method: "POST",
      headers: {
        host: "workia.local",
        origin: "https://workia.local",
      },
      body: formData,
    });

    const response = await POST(request);

    expect(response.status).toBe(302);
    expect(
      response.cookies
        .getAll()
        .some((entry) => entry.name === "__Secure-authjs.session-token"),
    ).toBe(true);
  });
});
