import { expect, test, type Page } from "@playwright/test";

/** Quick creates in a Sheet and the alta's decision footer (WRK-I6-4). */
const loginAsDemoRrhh = async (page: Page) => {
  await page.goto("/login");
  await page.locator("#email").fill("rrhh@workia.local");
  await page.locator("#password").fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/);
};

test.describe("Flows", () => {
  test("miembros: the list first, «Agregar miembro» in a Sheet, role change in a dialog", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/miembros");

    // No form above the list.
    await expect(page.getByLabel("Correo")).toHaveCount(0);
    await expect(page.getByTestId("member-row").first()).toBeVisible();

    await page.getByRole("button", { name: "Agregar miembro" }).click();
    const sheet = page.getByRole("dialog", { name: "Agregar miembro" });
    await expect(sheet.getByLabel("Correo")).toBeVisible();
    await expect(sheet).toContainText("Google");
    await sheet.getByRole("button", { name: "Cancelar" }).click();
    await expect(sheet).toHaveCount(0);

    const menu = page.getByRole("button", { name: /^Acciones de / }).first();
    if ((await menu.count()) === 0) return;
    await menu.click();
    await expect(
      page.getByRole("menuitem", { name: "Revocar acceso" }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "Cambiar rol" }).click();
    const dialog = page.getByRole("dialog", { name: "Cambiar rol" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("altas: «Iniciar alta» opens with an empty picker", async ({ page }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/altas");

    await expect(page.getByLabel("Persona")).toHaveCount(0);
    const start = page.getByRole("button", { name: "Iniciar alta" });
    if ((await start.count()) === 0) return;

    await start.click();
    const sheet = page.getByRole("dialog", { name: "Iniciar alta" });
    await expect(sheet.getByText("Elige una persona")).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Iniciar alta" }),
    ).toBeDisabled();
    await sheet.getByRole("button", { name: "Cancelar" }).click();
    await expect(sheet).toHaveCount(0);
  });

  test("alta detail: step strip, decision footer, autosaved capture", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/altas");

    const row = page.getByRole("table").getByRole("link").first();
    if ((await row.count()) === 0) return;
    await row.click();
    await expect(page).toHaveURL(/\/app\/altas\/[0-9a-f-]{36}/);

    await expect(page.getByTestId("alta-stages")).toContainText("RH");
    await expect(page.getByTestId("alta-stages")).toContainText("Nóminas");
    await expect(
      page.getByRole("button", { name: "Guardar captura" }),
    ).toHaveCount(0);

    const footer = page.getByTestId("alta-decision");
    if ((await footer.count()) === 0) return;
    const approve = footer.getByRole("button", { name: "Aprobar alta" });

    if ((await approve.count()) > 0) {
      const reject = footer.getByRole("button", { name: "Rechazar…" });
      if ((await reject.count()) > 0) {
        await reject.click();
        const dialog = page.getByRole("dialog", { name: "Rechazar alta" });
        await expect(dialog.getByLabel("Motivo")).toBeVisible();
        await dialog.getByRole("button", { name: "Cancelar" }).click();
        await expect(dialog).toHaveCount(0);
      }
    } else {
      // Who cannot approve reads why, in one line, instead of the buttons.
      await expect(footer.locator("p")).toHaveCount(1);
    }

    const field = page.locator("#fonacotCredito");
    if (await field.isDisabled()) return;
    const before = await field.inputValue();
    await field.fill("E2E-123");
    await expect(page.getByTestId("alta-save-state")).toHaveText("Guardado");
    await page.reload();
    await expect(page.locator("#fonacotCredito")).toHaveValue("E2E-123");
    await page.locator("#fonacotCredito").fill(before);
    await expect(page.getByTestId("alta-save-state")).toHaveText("Guardado");
  });

  test("conexiones: two tabs and the writes setting as a row", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/conexiones");

    await expect(page.getByRole("tab", { name: "Conexiones" })).toBeVisible();
    await page.getByRole("tab", { name: "Actividad" }).click();
    await expect(page.getByText(/Últimas 50 llamadas/)).toBeVisible();
    await expect(page.getByTestId("create-token-form")).toHaveCount(0);
  });
});
