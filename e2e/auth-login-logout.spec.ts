import { expect, test } from "@playwright/test";

const DEMO_EMAIL = "viewer@workia.local";
const DEMO_PASSWORD = "Workia123!";

test("login reaches /app and logout returns to login", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Correo electrónico").fill(DEMO_EMAIL);
  await page.getByRole("textbox", { name: "Contraseña" }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page).toHaveURL(/\/app/, { timeout: 15_000 });
  await expect(page.getByLabel("Menú de usuario")).toBeVisible({
    timeout: 15_000,
  });

  await page.getByLabel("Menú de usuario").click();
  await page.getByRole("menuitem", { name: "Cerrar sesión" }).click();

  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  const sessionResponse = await page.request.get("/api/auth/session");
  expect(sessionResponse.ok()).toBe(true);
  const session = (await sessionResponse.json()) as { user?: unknown } | null;
  expect(session?.user).toBeUndefined();
});
