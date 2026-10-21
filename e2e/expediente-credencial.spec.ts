import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

// The expediente «Credencial»: badge, key facts and section cards, no tabs.

const PEOPLE_ONLY_EMAIL = "solo-personas@workia.local";

const login = async (page: Page, email: string) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const fixture = (...args: string[]) => {
  execFileSync(
    "npx",
    ["tsx", "e2e/fixtures/expediente-credencial.ts", ...args],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      timeout: 60_000,
    },
  );
};

/** A dummy person with only the required fields, so most fields are missing. */
const createDummy = async (page: Page, surname: string) => {
  await page.goto("/app/personas/nueva");
  await page.locator("#nombres").fill("Persona");
  await page.locator("#apellidoPaterno").fill(surname);
  await page.getByRole("button", { name: "Guardar persona" }).click();
  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);

  return page.url().split("/").at(-1)!;
};

const openFirstExpediente = async (page: Page) => {
  await page.goto("/app/personas");
  await page
    .getByRole("table")
    .getByRole("link", { name: /^Ver expediente de / })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}/);
};

const card = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });

test.describe("Expediente «Credencial»", () => {
  test("activa: badge, facts, cards without tabs, open-at-section and emit", async ({
    page,
  }) => {
    const suffix = Date.now().toString().slice(-6);
    const fullName = `Persona Credencial${suffix}`;

    await login(page, "rrhh@workia.local");
    const personId = await createDummy(page, `Credencial${suffix}`);

    const credential = page.getByTestId("person-credential");
    await expect(credential).toHaveAttribute("data-status", "activa");
    await expect(
      credential.getByRole("heading", { level: 1, name: fullName }),
    ).toBeVisible();
    await expect(credential.getByText("Activa", { exact: true })).toBeVisible();

    const facts = page.getByTestId("person-key-facts");
    for (const label of [
      "Antigüedad",
      "Ingreso",
      "Contrato vigente",
      "Jefe directo",
      "Horario",
    ]) {
      await expect(facts.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(facts).toContainText("Sin contrato vigente");

    await expect(page.getByRole("tab")).toHaveCount(0);
    for (const name of [
      "Identidad",
      "Laboral",
      "Contacto",
      "Contrato",
      "Fiscal e IMSS",
      "Datos México",
      "Equipo en resguardo",
      "Historial de cambios",
    ]) {
      await expect(card(page, name)).toBeVisible();
    }
    await expect(card(page, "Baja")).toHaveCount(0);

    // A chip only scrolls: the URL keeps no hash and the card gets focus.
    const chips = page.getByRole("navigation", {
      name: "Secciones del expediente",
    });
    await chips.getByRole("link", { name: "Historial" }).click();
    await expect(card(page, "Historial de cambios")).toBeFocused();
    await expect(card(page, "Historial de cambios")).toBeInViewport();
    expect(page.url()).not.toContain("#");

    // Missing fields are grouped, and each one opens the form on its field.
    const fiscal = card(page, "Fiscal e IMSS");
    await expect(fiscal.getByTestId("missing-fields")).toHaveText(
      "Falta capturar: RFC, CURP, NSS",
    );
    await fiscal.getByRole("link", { name: "CURP", exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(
        `/app/personas/${personId}\\?edit=1&seccion=identificadores&campo=curp`,
      ),
    );
    await expect(page.locator("#curp")).toBeFocused();
    await expect(page.locator("#seccion-identificadores")).toBeInViewport();

    // Card «Editar» lands on its section.
    await page.goto(`/app/personas/${personId}`);
    await card(page, "Datos México")
      .getByRole("link", { name: "Editar Datos México" })
      .click();
    await expect(page).toHaveURL(/seccion=datos-mexico/);
    await expect(page.locator("#seccion-datos-mexico")).toBeInViewport();

    // ?emit=1 (it used to open the Contratos tab) lands on the Contrato card.
    await page.goto(`/app/personas/${personId}?emit=1`);
    const contrato = card(page, "Contrato");
    await expect(contrato).toBeFocused();
    await expect(contrato).toHaveAttribute("data-highlight", "true");
    await expect(contrato.locator("#startDate")).toBeVisible();

    await page.goto(`/app/personas/${personId}?saved=1`);
    await expect(page.getByRole("status")).toContainText("Cambios guardados.");
  });

  test("baja: grey badge, the baja block, «Reingresar» and masking", async ({
    page,
  }) => {
    const suffix = Date.now().toString().slice(-6);

    await login(page, "admin@workia.local");
    const personId = await createDummy(page, `CredencialBaja${suffix}`);
    // Through the domain: baja today, «Despido», not rehirable, a pending
    // finiquito of $4,321.50.
    fixture("set-baja", personId);
    await page.reload();

    const credential = page.getByTestId("person-credential");
    await expect(credential).toHaveAttribute("data-status", "baja");
    await expect(credential.getByText("Baja", { exact: true })).toBeVisible();
    await expect(
      page.getByTestId("person-key-facts").locator('[data-fact="antiguedad"]'),
    ).toContainText("Hasta la baja");

    const baja = card(page, "Baja");
    await expect(baja).toBeVisible();
    await expect(baja.getByTestId("baja-empty")).toHaveCount(0);
    await expect(baja).toContainText("Despido");
    await expect(baja.getByTestId("baja-recontratable")).toHaveText(
      /RecontratableNo/,
    );
    await expect(baja).toContainText("Pendiente");
    // The admin has compensation:read.
    await expect(baja.getByTestId("baja-finiquito-monto")).toContainText(
      "4,321.50",
    );
    await expect(
      page
        .getByRole("navigation", { name: "Secciones del expediente" })
        .getByRole("link")
        .first(),
    ).toHaveText("Baja");

    // «Reingresar» on the card opens the menu's dialog, which warns.
    await baja.getByRole("button", { name: "Reingresar" }).click();
    const rehire = page.getByRole("dialog");
    await expect(rehire).toContainText("no recontratable");
    await rehire.getByRole("button", { name: "Cancelar" }).click();
    await expect(rehire).toHaveCount(0);

    // A viewer (no people:update, no compensation:read): masked, no action.
    await page.context().clearCookies();
    await login(page, "viewer@workia.local");
    await page.goto(`/app/personas/${personId}`);
    const viewerBaja = card(page, "Baja");
    await expect(viewerBaja.getByTestId("baja-finiquito-monto")).toContainText(
      "•••",
    );
    await expect(viewerBaja).not.toContainText("4,321");
    await expect(
      viewerBaja.getByRole("button", { name: "Reingresar" }),
    ).toHaveCount(0);
  });

  test("sin permisos: no contract, resguardo, history or payroll", async ({
    page,
  }) => {
    fixture("people-only-user");

    await login(page, PEOPLE_ONLY_EMAIL);
    await openFirstExpediente(page);

    await expect(page.getByTestId("person-credential")).toBeVisible();
    await expect(card(page, "Identidad")).toBeVisible();
    for (const name of [
      "Contrato",
      "Equipo en resguardo",
      "Historial de cambios",
    ]) {
      await expect(card(page, name)).toHaveCount(0);
    }
    await expect(
      page.getByTestId("person-key-facts").getByText("Contrato vigente"),
    ).toHaveCount(0);
    await expect(page.getByTestId("contract-compensation")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Editar/ })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Emitir contrato" }),
    ).toHaveCount(0);
  });

  test("sin compensation:read the salary stays masked", async ({ page }) => {
    await login(page, "viewer@workia.local");
    await openFirstExpediente(page);

    // A viewer reads contracts but not payroll, nor the audit history.
    await expect(card(page, "Historial de cambios")).toHaveCount(0);
    const compensation = page.getByTestId("contract-compensation");

    if ((await compensation.count()) > 0) {
      await expect(compensation).not.toContainText("$");
    }
  });

  test("móvil: one column, sticky chips that scroll to a card", async ({
    page,
  }) => {
    await login(page, "rrhh@workia.local");
    await openFirstExpediente(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();

    const identidad = await card(page, "Identidad").boundingBox();
    const laboral = await card(page, "Laboral").boundingBox();
    expect(laboral!.y).toBeGreaterThan(identidad!.y + identidad!.height - 1);
    expect(Math.abs(laboral!.x - identidad!.x)).toBeLessThan(1);

    const chips = page.getByRole("navigation", {
      name: "Secciones del expediente",
    });
    await chips.getByRole("link", { name: "Datos México" }).click();
    const datos = card(page, "Datos México");
    await expect(datos).toBeFocused();
    await expect(datos).toBeInViewport();

    // The chips stay at the top of the scroller, above the card.
    const nav = await chips.boundingBox();
    const target = await datos.boundingBox();
    expect(nav!.y).toBeLessThan(120);
    expect(target!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
