import { expect, test } from "@playwright/test";

const DEMO_EMAIL = "viewer@workia.local";
const DEMO_PASSWORD = "Workia123!";

test("login reaches /app and logout returns to login", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");

  await page.getByLabel("Correo electrónico").fill(DEMO_EMAIL);
  await page.getByRole("textbox", { name: "Contraseña" }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
  await expect(page.getByLabel("Menú de usuario")).toBeVisible({
    timeout: 25_000,
  });

  await page.evaluate(() => {
    document.querySelector("nextjs-portal")?.remove();
  });

  // On a cold dev server the menu can be clicked before /app hydrates, and
  // that click is lost: click again until the menu opens.
  const logout = page.getByRole("menuitem", { name: "Cerrar sesión" });
  await expect(async () => {
    if (!(await logout.isVisible())) {
      await page.getByLabel("Menú de usuario").click();
    }
    await expect(logout).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 25_000 });
  await logout.click();

  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  const sessionResponse = await page.request.get("/api/auth/session");
  expect(sessionResponse.ok()).toBe(true);
  const session = (await sessionResponse.json()) as { user?: unknown } | null;
  expect(session?.user).toBeUndefined();
});
