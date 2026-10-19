import { expect, test } from "@playwright/test";

const loginAsDemoRrhh = async (page: import("@playwright/test").Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("rrhh@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

test.describe("Actividades de puesto", () => {
  test("RRHH crea, asigna, consulta en expediente y quita una actividad dummy", async ({
    page,
  }) => {
    const suffix = Date.now().toString().slice(-6);
    const activityName = `Actividad dummy e2e ${suffix}`;

    await loginAsDemoRrhh(page);

    await page.goto("/app/personas");
    const expedienteLink = page
      .getByRole("table")
      .getByRole("link", { name: /^Ver expediente de / })
      .first();
    await expect(expedienteLink).toBeVisible();
    await expedienteLink.click();
    await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}/);

    const puestoTerm = page.locator("dt").filter({ hasText: /^Puesto$/ });
    await expect(puestoTerm).toBeVisible();
    const puestoName = (
      await puestoTerm.locator("..").locator("dd").innerText()
    ).trim();
    expect(puestoName).not.toBe("—");
    expect(puestoName.length).toBeGreaterThan(0);

    const expedienteUrl = page.url();

    await page.goto("/app/catalogo/actividades");
    await expect(
      page.getByRole("heading", { name: "Actividades", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Nueva actividad" }).click();
    const createSheet = page.getByRole("dialog", { name: "Nueva actividad" });
    await createSheet.getByLabel("Nombre").fill(activityName);
    await createSheet.getByRole("button", { name: "Crear actividad" }).click();
    await expect(page.getByRole("status")).toContainText("Cambios guardados");
    await expect(createSheet).toHaveCount(0);
    await expect(
      page.getByRole("cell", { name: activityName, exact: true }),
    ).toBeVisible();

    const openPuesto = async () => {
      await page.goto("/app/catalogo/puestos");
      await page
        .getByRole("table")
        .getByRole("button", { name: `Editar ${puestoName}`, exact: true })
        .click();
      return page.getByRole("dialog", { name: "Editar puesto" });
    };

    let sheet = await openPuesto();
    await sheet.getByRole("button", { name: "Agregar" }).click();
    await page.getByRole("option", { name: activityName, exact: true }).click();
    await expect(
      sheet
        .getByRole("list", { name: "Actividades del puesto" })
        .getByText(activityName, { exact: true }),
    ).toBeVisible();
    await sheet.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("status")).toContainText("Cambios guardados");

    await page.goto(expedienteUrl);
    // The expediente renders its tabs for desktop and phone; check the visible one.
    await expect(
      page.getByText("Actividades del puesto").locator("visible=true"),
    ).toBeVisible();
    await expect(
      page.getByText(activityName, { exact: true }).locator("visible=true"),
    ).toBeVisible();

    sheet = await openPuesto();
    await sheet
      .getByRole("button", { name: `Quitar ${activityName}`, exact: true })
      .click();
    await sheet.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("status")).toContainText("Cambios guardados");

    await page.goto(expedienteUrl);
    await expect(page.getByText(activityName, { exact: true })).toHaveCount(0);
  });
});
