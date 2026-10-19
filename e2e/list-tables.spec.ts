import { expect, test } from "@playwright/test";

const loginAsDemoRrhh = async (page: import("@playwright/test").Page) => {
  await page.goto("/login");
  await page.locator("#email").fill("rrhh@workia.local");
  await page.locator("#password").fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/);
};

test.describe("Authenticated list tables", () => {
  test("personas: the row opens the expediente, actions in the ⋯ menu, footer pages", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/personas");

    await expect(
      page.getByRole("heading", { name: "Personas", exact: true }),
    ).toBeVisible();

    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    // No «Ver expediente» column or text buttons in the rows.
    await expect(
      table.getByRole("columnheader", { name: "Expediente" }),
    ).toHaveCount(0);
    await expect(table.getByRole("button", { name: /^Ver/ })).toHaveCount(0);

    const footer = page.locator("[data-slot=data-table-footer]");
    await expect(footer).toContainText(/1–\d+ de \d+/);
    await expect(
      footer.getByRole("button", { name: "Página siguiente" }),
    ).toBeVisible();
    await expect(page.getByText("Anterior", { exact: true })).toHaveCount(0);

    const firstRow = table.getByRole("link", { name: /^Ver expediente de / });
    const menu = page.getByRole("button", { name: /^Acciones de / }).first();
    await menu.click();
    await expect(page.getByRole("menuitem", { name: "Editar" })).toBeVisible();
    await page.keyboard.press("Escape");
    // Closing the menu does not open the row.
    await expect(page).toHaveURL(/\/app\/personas(\?.*)?$/);

    await firstRow.first().click();
    await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}/);
  });

  test("plantillas: the row opens the template", async ({ page }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/contratos/plantillas");

    await expect(
      page.getByRole("heading", { name: "Plantillas de contrato" }),
    ).toBeVisible();
    await expect(
      page.getByRole("table").getByRole("columnheader", { name: "Acciones" }),
    ).toHaveCount(0);

    await page
      .getByRole("link", { name: /^Editar plantilla / })
      .first()
      .click();
    await expect(page).toHaveURL(/\/app\/contratos\/plantillas\/[0-9a-f-]{36}/);
  });

  test("contratos: status column and one flow, «Decidir renovación»", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/contratos");

    await expect(
      page.getByRole("heading", { name: "Contratos", exact: true }),
    ).toBeVisible();

    const table = page.getByRole("table");
    await expect(
      table.getByRole("columnheader", { name: "Estado" }),
    ).toBeVisible();
    await expect(table.getByRole("button", { name: /^Renovar/ })).toHaveCount(
      0,
    );
    await expect(page.getByLabel("Nuevo tipo")).toHaveCount(0);

    const rows = page.getByTestId("renewal-row");
    if ((await rows.count()) === 0) {
      return;
    }

    const first = rows.first();
    await expect(
      first.getByText(/^(En \d+ días?|Vence hoy|Vencido|En ventana)$/),
    ).toBeVisible();

    // One inline action, shown on hover.
    await first.hover();
    const decidir = first.getByRole("button", {
      name: /^Decidir renovación de /,
    });
    await expect(decidir).toBeVisible();
    await decidir.click();
    const dialog = page.getByRole("dialog", { name: "Decidir renovación" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/app\/contratos/);

    // The menu offers the same dialog; there is no inline «Renovar» panel.
    await first.getByRole("button", { name: /^Acciones de / }).click();
    await expect(page.getByRole("menuitem")).toHaveText([
      "Decidir renovación",
      "Ver expediente",
    ]);
    await page.getByRole("menuitem", { name: "Decidir renovación" }).click();
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("Nuevo tipo")).toHaveCount(0);
  });
});
