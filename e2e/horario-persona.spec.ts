import { expect, test } from "@playwright/test";

import { chooseSelectOption } from "./choose-select-option";

const loginAsDemoRrhh = async (page: import("@playwright/test").Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("rrhh@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

type Times = {
  entrada: string;
  salidaComer: string;
  regresoComer: string;
  salida: string;
};

/** One Monday–Friday block in the schedule-by-blocks editor (WRK-I5-3). */
const fillSchedule = async (
  page: import("@playwright/test").Page,
  times: Times,
) => {
  // A new person starts without blocks; an edit already shows the first one.
  await expect(page.getByTestId("schedule-blocks-editor")).toBeVisible();
  if ((await page.locator("#bloque-0-entrada").count()) === 0) {
    await page
      .getByTestId("schedule-blocks-editor")
      .getByRole("button", { name: "Agregar bloque" })
      .click();
  }

  await page.locator("#bloque-0-entrada").fill(times.entrada);
  await page.locator("#bloque-0-comidaInicio").fill(times.salidaComer);
  await page.locator("#bloque-0-comidaFin").fill(times.regresoComer);
  await page.locator("#bloque-0-salida").fill(times.salida);
};

const scheduleText = (times: Times) =>
  `L–V ${times.entrada}–${times.salida} (comida ${times.salidaComer}–${times.regresoComer})`;

const datosPanel = (page: import("@playwright/test").Page) =>
  page.getByRole("tabpanel", { name: "Datos" });

const contractCard = (page: import("@playwright/test").Page) =>
  page
    .getByRole("heading", { name: "Contratos" })
    .locator("xpath=ancestor::section[1]");

const expectScheduleOnFicha = async (
  root: import("@playwright/test").Locator,
  times: Times,
  label: RegExp = /^Horario$/,
) => {
  const term = root.locator("dt").filter({ hasText: label });
  await expect(term).toBeVisible();
  await expect(term.locator("..").locator("dd")).toHaveText(
    scheduleText(times),
  );
};

test.describe("Horario por persona", () => {
  test("two dummy people share puesto and sucursal but keep distinct schedules", async ({
    page,
  }) => {
    const suffix = Date.now().toString().slice(-6);
    const nameA = `Persona HorarioA${suffix} Demo`;
    const nameB = `Persona HorarioB${suffix} Demo`;
    const scheduleA = {
      entrada: "08:00",
      salidaComer: "13:00",
      regresoComer: "14:00",
      salida: "17:00",
    };
    const scheduleB = {
      entrada: "09:00",
      salidaComer: "14:00",
      regresoComer: "15:00",
      salida: "18:00",
    };
    const laterSchedule = {
      entrada: "10:00",
      salidaComer: "15:00",
      regresoComer: "16:00",
      salida: "19:00",
    };

    await loginAsDemoRrhh(page);

    await page.goto("/app/personas/nueva");
    await page.locator("#nombres").fill("Persona");
    await page.locator("#apellidoPaterno").fill(`HorarioA${suffix}`);
    await page.locator("#apellidoMaterno").fill("Demo");
    await chooseSelectOption(page.locator("#positionId"), "Analista");
    await chooseSelectOption(
      page.locator("#siteId"),
      "Sucursal Centro Demo (Sucursal)",
    );
    await fillSchedule(page, scheduleA);
    await page.getByRole("button", { name: "Dar de alta" }).click();
    await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}/);
    await expect(
      page.getByRole("heading", { name: nameA, exact: true }),
    ).toBeVisible();
    await expectScheduleOnFicha(datosPanel(page), scheduleA);
    const expedienteA = page.url();

    await page.goto("/app/personas/nueva");
    await page.locator("#nombres").fill("Persona");
    await page.locator("#apellidoPaterno").fill(`HorarioB${suffix}`);
    await page.locator("#apellidoMaterno").fill("Demo");
    await chooseSelectOption(page.locator("#positionId"), "Analista");
    await chooseSelectOption(
      page.locator("#siteId"),
      "Sucursal Centro Demo (Sucursal)",
    );
    await fillSchedule(page, scheduleB);
    await page.getByRole("button", { name: "Dar de alta" }).click();
    await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}/);
    await expect(
      page.getByRole("heading", { name: nameB, exact: true }),
    ).toBeVisible();
    await expectScheduleOnFicha(datosPanel(page), scheduleB);

    const puestoA = (
      await page
        .locator("dt")
        .filter({ hasText: /^Puesto$/ })
        .locator("..")
        .locator("dd")
        .innerText()
    ).trim();
    const sitioB = (
      await page
        .locator("dt")
        .filter({ hasText: /^Ubicación$/ })
        .locator("..")
        .locator("dd")
        .innerText()
    ).trim();
    expect(puestoA).toBe("Analista");
    expect(sitioB).toMatch(/Sucursal Centro Demo/);

    await page.goto(expedienteA);
    await expectScheduleOnFicha(datosPanel(page), scheduleA);
    await expect(page.getByText("09:00")).toHaveCount(0);

    await page.getByRole("link", { name: "Emitir contrato" }).click();
    await expect(page).toHaveURL(/emit=1/);
    await page.getByRole("tab", { name: "Contratos" }).click();
    await expect(page.locator("#startDate")).toBeVisible();
    await page.locator("#startDate").fill("2026-01-15");
    await page.locator("#endDate").fill("2026-12-15");
    await page.getByRole("button", { name: "Emitir contrato" }).click();
    await expect(page).toHaveURL(/contract=created/);
    await expect(
      page.getByText("Contrato emitido y guardado en el expediente."),
    ).toBeVisible();

    const contractSection = contractCard(page);
    await expectScheduleOnFicha(
      contractSection,
      scheduleA,
      /^Horario al emitir$/,
    );
    await contractSection.getByText("Ver texto generado").click();
    await expect(contractSection.locator("pre")).toContainText(
      scheduleText(scheduleA),
    );
    await expect(contractSection.locator("pre")).not.toContainText("10:00");

    await page.getByRole("link", { name: "Editar" }).click();
    await fillSchedule(page, laterSchedule);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page).toHaveURL(/saved=1/);
    await expectScheduleOnFicha(datosPanel(page), laterSchedule);

    await page.getByRole("tab", { name: "Contratos" }).click();
    const contractAfterEdit = contractCard(page);
    await expectScheduleOnFicha(
      contractAfterEdit,
      scheduleA,
      /^Horario al emitir$/,
    );
    await contractAfterEdit.getByText("Ver texto generado").click();
    await expect(contractAfterEdit.locator("pre")).toContainText(
      scheduleText(scheduleA),
    );
    await expect(contractAfterEdit.locator("pre")).not.toContainText("10:00");
    await expect(contractAfterEdit.getByText("10:00")).toHaveCount(0);
  });
});
