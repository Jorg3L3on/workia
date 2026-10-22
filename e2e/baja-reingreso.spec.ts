import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { chooseSelectOption } from "./choose-select-option";

/**
 * Baja y periodos laborales (Iniciativa 2): a baja with its fields and the
 * expediente's baja block, a reingreso from that block in the same
 * expediente, both periods in the Laboral card and both in Historial.
 * Fictional data; the person is hard-deleted at the end.
 */
test.describe.configure({ mode: "serial" });

const loginAsDemoAdmin = async (page: Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const hardDelete = (fullName: string) => {
  execFileSync(
    "npx",
    ["tsx", "scripts/cleanup-borrados-residue.ts", "--full-name", fullName],
    { cwd: process.cwd(), stdio: "inherit", timeout: 60_000 },
  );
};

/** Removes the dummy even when the test failed before it was soft-deleted. */
const hardDeleteById = (personId: string) => {
  execFileSync(
    "npx",
    ["tsx", "e2e/fixtures/expediente-credencial.ts", "hard-delete", personId],
    { cwd: process.cwd(), stdio: "inherit", timeout: 60_000 },
  );
};

const mx = (date: Date) =>
  [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear(),
  ].join("/");

test("baja → reingreso → historial keeps both periods", async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  // «Borrada Demo» so the cleanup script recognizes it as test residue.
  const fullName = `Persona Borrada Demo${suffix}`;
  const ingreso = new Date(Date.now() - 400 * 86_400_000);
  const reingreso = new Date(Date.now() + 31 * 86_400_000);
  let personId: string | undefined;

  try {
    await loginAsDemoAdmin(page);
    await page.goto("/app/personas/nueva");
    await page.locator("#nombres").fill("Persona");
    await page.locator("#apellidoPaterno").fill("Borrada");
    await page.locator("#apellidoMaterno").fill(`Demo${suffix}`);
    await page.locator("#fechaIngreso").fill(mx(ingreso));
    await page.getByRole("button", { name: "Guardar persona" }).click();
    await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);
    personId = page.url().split("/").at(-1);

    // Baja: fecha (today by default), tipo, motivo, comentario, recontratable.
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Dar de baja" }).click();
    const baja = page.getByRole("dialog");
    await baja.getByRole("button", { name: "Dar de baja" }).click();
    await expect(baja.getByRole("alert").first()).toBeVisible();
    await chooseSelectOption(baja.getByLabel("Tipo de baja"), "Voluntaria");
    await chooseSelectOption(baja.getByLabel("Motivo"), "Cambio de residencia");
    await baja.getByLabel(/Comentario/).fill("Se muda a otra ciudad");
    await baja.getByRole("radio", { name: "Sí" }).check();
    await baja.getByRole("button", { name: "Dar de baja" }).click();
    await expect(baja).toHaveCount(0);
    await expect(page).toHaveURL(/\?baja=1$/);
    await expect(page.getByText("Baja registrada.")).toBeVisible();
    await expect(page.getByTestId("person-credential")).toHaveAttribute(
      "data-status",
      "baja",
    );

    // The baja block: fecha, tipo, motivo, comentario, recontratable.
    const bajaCard = page.getByRole("region", { name: "Baja", exact: true });
    await expect(bajaCard).toContainText("Voluntaria");
    await expect(bajaCard).toContainText("Cambio de residencia");
    await expect(bajaCard).toContainText("Se muda a otra ciudad");
    await expect(bajaCard.getByTestId("baja-recontratable")).toHaveText(
      /RecontratableSí/,
    );

    // Finiquito after the baja.
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Finiquito" }).click();
    const finiquito = page.getByRole("dialog");
    await chooseSelectOption(finiquito.getByLabel("Estado"), "Pendiente");
    await finiquito.getByLabel("Monto (MXN)").fill("12345.67");
    await finiquito.getByRole("button", { name: "Guardar finiquito" }).click();
    await expect(finiquito).toHaveCount(0);
    await expect(page.getByText("Finiquito actualizado.")).toBeVisible();
    await expect(bajaCard.getByTestId("baja-finiquito-monto")).toContainText(
      "12,345.67",
    );

    // Reingreso from the baja block (the menu's dialog), seniority restarts.
    await bajaCard.getByRole("button", { name: "Reingresar" }).click();
    const rehire = page.getByRole("dialog");
    await expect(rehire.getByRole("radio", { name: /^No/ })).toBeChecked();
    await rehire.getByLabel("Fecha de ingreso").fill(mx(reingreso));
    await rehire.getByRole("button", { name: "Reingresar" }).click();
    await expect(rehire).toHaveCount(0);
    await expect(page.getByText("Reingreso registrado")).toBeVisible();
    await expect(
      page.getByText("Activa", { exact: true }).first(),
    ).toBeVisible();
    // Rehired: the normal badge, no baja block, the period in Ingreso.
    await expect(page.getByTestId("person-credential")).toHaveAttribute(
      "data-status",
      "activa",
    );
    await expect(
      page.getByRole("region", { name: "Baja", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("person-key-facts").locator('[data-fact="ingreso"]'),
    ).toContainText("2.º periodo · antigüedad reiniciada");

    // Laboral: both periods, oldest first.
    const periods = page
      .getByRole("region", { name: "Laboral", exact: true })
      .getByTestId("employment-periods")
      .getByRole("listitem");
    await expect(periods).toHaveCount(2);
    await expect(periods.first()).toContainText("Cambio de residencia");
    await expect(periods.last()).toContainText("en curso");

    // Historial: the baja with its fields, the finiquito and the reingreso.
    const history = page.getByRole("region", {
      name: "Historial de cambios",
      exact: true,
    });
    // The table's Acción cells: the same events also render as phone cards,
    // hidden on desktop, so match the cells rather than the first text.
    for (const accion of [
      "Baja laboral",
      "Reingreso",
      "Finiquito actualizado",
    ]) {
      await expect(
        history.getByRole("cell", { name: accion, exact: true }),
      ).toBeVisible();
    }
    await expect(history).toContainText("Cambio de residencia");
    // The admin sees payroll data; the amount is in the finiquito change.
    await expect(history).toContainText("12345.67");

    // Active again: the menu offers a new baja.
    await page.getByRole("button", { name: "Más acciones" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Dar de baja" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    // Reopening while the menu still plays its exit leaves it closed.
    await expect(page.getByRole("menu")).toHaveCount(0);

    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Eliminar expediente" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Eliminar" })
      .click();
  } finally {
    hardDelete(fullName);
    if (personId) hardDeleteById(personId);
  }
});
