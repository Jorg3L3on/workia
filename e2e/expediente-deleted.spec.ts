import { expect, test } from "@playwright/test";

const artifactsDir = process.env.E2E_ARTIFACTS_DIR;

test.use({
  video: artifactsDir ? { mode: "on", dir: artifactsDir } : "off",
});

const loginAsDemoAdmin = async (page: import("@playwright/test").Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const capture = async (
  page: import("@playwright/test").Page,
  filename: string,
) => {
  if (!artifactsDir) {
    return;
  }

  await page.screenshot({
    path: `${artifactsDir}/${filename}`,
    fullPage: true,
  });
};

test("soft-deleted expediente stays open and appears in borrados", async ({
  page,
}) => {
  const suffix = Date.now().toString().slice(-6);
  const fullName = `Persona Borrada Demo${suffix}`;

  await loginAsDemoAdmin(page);
  await page.goto("/app/personas/nueva");

  await page.locator("#nombres").fill("Persona");
  await page.locator("#apellidoPaterno").fill("Borrada");
  await page.locator("#apellidoMaterno").fill(`Demo${suffix}`);
  await page.getByRole("button", { name: "Dar de alta" }).click();

  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: fullName, exact: true }),
  ).toBeVisible();

  const expedienteUrl = page.url();

  await page
    .getByRole("button", { name: "Borrar expediente (lógico)" })
    .click();

  await expect(page).toHaveURL(expedienteUrl);
  await expect(page.getByText("404", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: fullName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Borrado", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Expediente borrado" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Borrar expediente (lógico)" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0);

  await page.goto(expedienteUrl);
  await expect(
    page.getByRole("heading", { name: fullName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Borrado", { exact: true }).first(),
  ).toBeVisible();
  await capture(page, "expediente_borrado_ficha.png");

  await page.getByRole("link", { name: "Ver listado de borrados" }).click();
  await expect(page).toHaveURL(/\/app\/personas\?deleted=1/);
  await expect(page.locator("table").getByText(fullName)).toBeVisible();
  await expect(
    page.locator("table").getByText("Borrado", { exact: true }).first(),
  ).toBeVisible();

  await capture(page, "personas_borrados_list.png");

  await page.locator("#persona-visibility").selectOption("expediente");
  await expect(page.getByText(fullName)).toHaveCount(0);
});
