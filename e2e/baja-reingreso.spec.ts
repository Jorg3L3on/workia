import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

import { chooseSelectOption } from "./choose-select-option";

/**
 * Baja y periodos laborales (Iniciativa 2): a baja with its fields, a
 * reingreso in the same expediente and both in Historial. Fictional data;
 * the person is hard-deleted at the end.
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

  try {
    await loginAsDemoAdmin(page);
    await page.goto("/app/personas/nueva");
    await page.locator("#nombres").fill("Persona");
    await page.locator("#apellidoPaterno").fill("Borrada");
    await page.locator("#apellidoMaterno").fill(`Demo${suffix}`);
    await page.locator("#fechaIngreso").fill(mx(ingreso));
    await page.getByRole("button", { name: "Guardar persona" }).click();
    await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);

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
    await expect(page.getByText("Baja", { exact: true }).first()).toBeVisible();

    // Finiquito after the baja.
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Finiquito" }).click();
    const finiquito = page.getByRole("dialog");
    await chooseSelectOption(finiquito.getByLabel("Estado"), "Pendiente");
    await finiquito.getByLabel("Monto (MXN)").fill("12345.67");
    await finiquito.getByRole("button", { name: "Guardar finiquito" }).click();
    await expect(finiquito).toHaveCount(0);

    // Reingreso in the same expediente, seniority restarts (default).
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Reingresar" }).click();
    const rehire = page.getByRole("dialog");
    await expect(rehire.getByRole("radio", { name: /^No/ })).toBeChecked();
    await rehire.getByLabel("Fecha de ingreso").fill(mx(reingreso));
    await rehire.getByRole("button", { name: "Reingresar" }).click();
    await expect(rehire).toHaveCount(0);
    await expect(
      page.getByText("Activa", { exact: true }).first(),
    ).toBeVisible();

    // Historial: the baja with its fields, the finiquito and the reingreso.
    await page.getByRole("tab", { name: "Historial" }).click();
    const history = page.getByRole("tabpanel");
    await expect(history.getByText("Baja laboral").first()).toBeVisible();
    await expect(history.getByText("Reingreso").first()).toBeVisible();
    await expect(
      history.getByText("Finiquito actualizado").first(),
    ).toBeVisible();
    await expect(history).toContainText("Cambio de residencia");
    // The admin sees payroll data; the amount is in the finiquito change.
    await expect(history).toContainText("12345.67");

    // Active again: the menu offers a new baja.
    await page.getByRole("button", { name: "Más acciones" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Dar de baja" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("menuitem", { name: "Eliminar expediente" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Eliminar" })
      .click();
  } finally {
    hardDelete(fullName);
  }
});
