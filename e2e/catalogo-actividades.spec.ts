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
      .getByRole("link", { name: "Ver expediente" })
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

    await page.getByLabel("Nombre").fill(activityName);
    await page.getByRole("button", { name: "Crear actividad" }).click();
    await expect(page.getByRole("status")).toContainText("Cambios guardados");
    await expect(
      page.getByRole("cell", { name: activityName, exact: true }),
    ).toBeVisible();

    await page.goto("/app/catalogo/puestos");
    await expect(
      page.getByRole("heading", { name: "Puestos", exact: true }),
    ).toBeVisible();

    await page
      .getByLabel("Puesto a asignar")
      .selectOption({ label: puestoName });
    await page
      .getByLabel("Actividad a asignar")
      .selectOption({ label: activityName });
    await page.getByRole("button", { name: "Asignar actividad" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Actividad asignada al puesto",
    );
    await page
      .getByPlaceholder("Buscar puesto, área o actividad")
      .fill(activityName);
    await expect(
      page.getByRole("table").getByText(activityName, { exact: true }),
    ).toBeVisible();

    await page.goto(expedienteUrl);
    await expect(page.getByText("Actividades del puesto")).toBeVisible();
    await expect(page.getByText(activityName, { exact: true })).toBeVisible();

    await page.goto("/app/catalogo/puestos");
    await page
      .getByPlaceholder("Buscar puesto, área o actividad")
      .fill(activityName);
    await page
      .getByRole("button", { name: `Quitar ${activityName} de ${puestoName}` })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Actividad quitada del puesto",
    );
    await page
      .getByPlaceholder("Buscar puesto, área o actividad")
      .fill(activityName);
    await expect(
      page.getByRole("table").getByText(activityName, { exact: true }),
    ).toHaveCount(0);

    await page.goto(expedienteUrl);
    await expect(page.getByText(activityName, { exact: true })).toHaveCount(0);
  });
});
