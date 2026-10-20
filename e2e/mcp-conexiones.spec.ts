import { createHash, randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

// Seeded demo account (scripts/seed.ts): super_admin in «Empresa Demo».
const ADMIN_EMAIL = "admin@workia.local";
const DEMO_PASSWORD = "Workia123!";
const REDIRECT_URI = "http://localhost:6274/oauth/callback";

const login = async (page: Page) => {
  // A cold dev server compiles /api/auth on the first sign-in; submitting
  // before the page settles ends in MissingCSRF.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Correo electrónico").fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: "Contraseña" }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
};

const whoami = (page: Page, token: string) =>
  page.request.post("/api/mcp", {
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    },
  });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("personal token: create, copy, use and revoke in /app/conexiones", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/login?callbackUrl=%2Fapp%2Fconexiones");
  await login(page);
  await expect(page).toHaveURL(/\/app\/conexiones/, { timeout: 25_000 });

  const name = `E2E ${Date.now()}`;
  await page.getByRole("button", { name: "Nuevo token" }).click();
  await page.getByLabel("Nombre").fill(name);
  await page.getByRole("button", { name: "Crear token" }).click();

  const dialog = page.getByTestId("token-once-dialog");
  await expect(dialog).toBeVisible();
  const token = (await dialog.locator("pre").first().textContent())!.trim();
  expect(token).toMatch(/^workia_pat_/);

  await dialog.getByRole("button", { name: "Copiar" }).first().click();
  await expect(dialog.getByRole("button", { name: "Copiado" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);
  await dialog.getByRole("button", { name: "Ya lo copié" }).click();

  const response = await whoami(page, token);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("Empresa Demo");

  const row = page.getByTestId("connection-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `Acciones de ${name}` }).click();
  await page.getByRole("menuitem", { name: "Revocar" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Revocar" })
    .click();
  await expect(row.getByText("Revocada")).toBeVisible();

  expect((await whoami(page, token)).status()).toBe(401);
});

test("OAuth: login, pick the company, consent and exchange the code", async ({
  page,
}) => {
  const registration = await page.request.post("/api/oauth/register", {
    data: { client_name: "E2E Inspector", redirect_uris: [REDIRECT_URI] },
  });
  expect(registration.status()).toBe(201);
  const { client_id: clientId } = (await registration.json()) as {
    client_id: string;
  };

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "e2e-state",
    scope: "read offline_access",
  });

  // The client's callback is not running: capture the redirect instead.
  let callback: URL | null = null;
  await page.route(`${REDIRECT_URI}**`, async (route) => {
    callback = new URL(route.request().url());
    await route.fulfill({ status: 200, body: "ok" });
  });

  await page.goto(`/api/oauth/authorize?${authorize}`);
  // No session yet: login first, then back to the consent screen.
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  await login(page);
  await expect(page).toHaveURL(/\/oauth\/consent/, { timeout: 25_000 });

  // With several companies the person picks one first (the seed gives two).
  const picker = page.getByRole("heading", { name: /¿Con qué empresa/ });
  const consent = page.getByRole("heading", {
    name: "E2E Inspector quiere acceder a Workia",
  });
  await expect(picker.or(consent)).toBeVisible();
  if (await picker.isVisible()) {
    await page.getByRole("link", { name: /Empresa Demo/ }).click();
  }

  await expect(
    page.getByRole("heading", {
      name: "E2E Inspector quiere acceder a Workia",
    }),
  ).toBeVisible();
  // The server action answers with a redirect to the client's callback; read
  // it from the response, or from the navigation if the router followed it.
  const approval = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/oauth/consent"),
  );
  await page.getByRole("button", { name: "Permitir acceso" }).click();
  // Hydrated: x-action-redirect. Clicked before hydration (a plain form post):
  // a 303 with Location. Either way the server sends the client back with a code.
  const headers = (await approval).headers();
  const redirect = (headers["x-action-redirect"] ?? headers["location"])?.split(
    ";",
  )[0];
  if (!callback && redirect) {
    callback = new URL(redirect);
  }
  // 10 new connections per person per hour (spec §7): rerunning this suite
  // many times within an hour against the same database trips it.
  await expect(page.getByText(/demasiadas conexiones/)).toHaveCount(0);
  await expect
    .poll(() => callback?.searchParams.get("code") ?? null, { timeout: 25_000 })
    .not.toBeNull();
  expect(callback!.searchParams.get("state")).toBe("e2e-state");

  const tokenResponse = await page.request.post("/api/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code: callback!.searchParams.get("code")!,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    },
  });
  expect(tokenResponse.status()).toBe(200);
  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  expect(tokens.access_token).toMatch(/^workia_at_/);
  expect(tokens.refresh_token).toMatch(/^workia_rt_/);
  expect(tokens.expires_in).toBe(3600);

  const response = await whoami(page, tokens.access_token);
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain("Empresa Demo");
});
