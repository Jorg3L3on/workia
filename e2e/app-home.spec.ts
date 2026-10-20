import { expect, test } from "@playwright/test";

test("personas route redirects unauthenticated users to login", async ({
  page,
}) => {
  await page.goto("/app/personas");

  await expect(page).toHaveURL(/\/login/);
});

test("home app route redirects unauthenticated users to login", async ({
  page,
}) => {
  await page.goto("/app");

  await expect(page).toHaveURL(/\/login/);
});

test("Inicio shows linked KPIs and ⌘K finds a person by RFC", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 25_000 });

  const main = page.getByRole("main");
  for (const [label, href] of [
    ["Personas activas", "/app/personas?status=activa"],
    ["Contratos por vencer", "/app/contratos"],
    ["Altas en proceso", "/app/altas"],
    ["Equipo pendiente", "/app/resguardo?status=asignado"],
  ]) {
    await expect(
      main.getByRole("link", { name: new RegExp(label) }).first(),
    ).toHaveAttribute("href", href);
  }
  await expect(main.getByRole("link", { name: "Nueva persona" })).toBeVisible();
  await expect(main.getByText(/\d+ urgentes?/)).toHaveCount(0);

  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar.getByText("Operación", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Plataforma" })).toBeVisible();

  await page.evaluate(() => {
    document.querySelector("nextjs-portal")?.remove();
  });
  await page.getByRole("button", { name: "Buscar en Workia" }).click();
  await page.getByRole("combobox").fill("XAXX010101002");
  await page.getByRole("option", { name: /Sofía Demo Ejemplo/ }).click();
  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);
});
