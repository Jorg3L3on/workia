import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/**
 * Privacidad (W2-09): HR publishes a version of the notice, registers an
 * ARCO access request, downloads the person's data export on the spot and
 * closes the request; the download shows in Accesos. A viewer (no
 * privacy:read) sees no entry and gets a 403 on the export.
 */
test.describe.configure({ mode: "serial" });

const PASSWORD = "Workia123!";

const login = async (page: Page, email: string) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByRole("textbox", { name: "Contraseña" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    try {
      await expect(page).toHaveURL(/\/(app|admin|empresa)/, {
        timeout: 15_000,
      });
      return;
    } catch (error) {
      // A cold dev server drops the first sign-in with MissingCSRF.
      if (attempt === 1) throw error;
    }
  }
};

let exportHref: string | null = null;

test("notice → ARCO access request → export → close", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "admin@workia.local");
  await page.goto("/app/privacidad");
  await expect(page.getByRole("heading", { name: "Privacidad" })).toBeVisible();

  const noticeText = `Aviso de privacidad de prueba ${Date.now()}`;

  await page
    .getByLabel(/Texto (del aviso|de la nueva versión)/)
    .fill(noticeText);
  await page.getByRole("button", { name: "Publicar versión" }).click();
  await expect(page.getByText("Aviso publicado.")).toBeVisible();
  // A cold dev server can serve the first reload before it recompiles.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(noticeText).first()).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });

  await page.getByRole("tab", { name: /Solicitudes ARCO/ }).click();
  await page.getByRole("combobox", { name: "Persona" }).fill("Elena");
  await page.getByRole("option", { name: /Elena/ }).first().click();

  const detail = `Quiere copia de sus datos ${Date.now()}`;

  await page.getByLabel("Qué pide la persona").fill(detail);
  await page.getByRole("button", { name: "Registrar solicitud" }).click();
  await expect(page.getByText("Solicitud registrada.")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: /Solicitudes ARCO/ }).click();

  const row = page.getByRole("row").filter({ hasText: detail });

  await expect(row.getByText("Pendiente")).toBeVisible();
  await expect(row.getByText(/Faltan 20 días/)).toBeVisible();

  const link = row.getByRole("link", { name: "Exportar datos" });

  exportHref = await link.getAttribute("href");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    link.click(),
  ]);
  const file = await download.path();
  const data = JSON.parse(readFileSync(file, "utf8")) as {
    person: { nombres: string };
    arcoRequests: Array<{ detail: string }>;
  };

  expect(data.person.nombres).toBe("Elena");
  expect(data.arcoRequests.map((request) => request.detail)).toContain(detail);

  await row.getByRole("button", { name: "Cerrar" }).click();
  await page.getByLabel("Respuesta").fill("Se entregó la exportación.");
  await page.getByRole("button", { name: "Cerrar solicitud" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.reload();
  await page.getByRole("tab", { name: /Solicitudes ARCO/ }).click();
  await expect(
    page.getByRole("row").filter({ hasText: detail }).getByText("Atendida"),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Accesos" }).click();
  await expect(page.getByText("Exportación ARCO").first()).toBeVisible();
});

test("a viewer has no Privacidad and cannot export", async ({ page }) => {
  await login(page, "viewer@workia.local");
  await page.goto("/app");
  await expect(page.getByRole("link", { name: "Privacidad" })).toHaveCount(0);

  if (exportHref) {
    const response = await page.request.get(exportHref);

    expect(response.status()).toBe(403);
  }
});
