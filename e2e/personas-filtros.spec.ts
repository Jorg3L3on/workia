import { expect, test } from "@playwright/test";

const loginAsDemoAdmin = async (page: import("@playwright/test").Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const exportCount = async (page: import("@playwright/test").Page) => {
  const text = await page.getByTestId("personas-exportar").innerText();
  return Number(text.replace(/\D/g, ""));
};

test.describe("Personas: filtros avanzados (Iniciativa 3)", () => {
  test("filter → URL → reload → «Exportar (N)» downloads the same N rows", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsDemoAdmin(page);
    await page.goto("/app/personas");

    await page.getByRole("button", { name: "Relación", exact: true }).click();
    await page.getByRole("option", { name: /Activas/ }).click();
    await expect(page).toHaveURL(/f=1\*st\.i\.activa/);

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Filtro", exact: true }).click();
    await page.getByRole("option", { name: "Fecha de ingreso" }).click();
    await page.getByRole("button", { name: "Este año" }).click();
    await expect(page).toHaveURL(/in\.b\.\d{8}\.\d{8}/);
    await page.keyboard.press("Escape");

    const url = page.url();
    const n = await exportCount(page);

    await page.reload();
    await expect(page).toHaveURL(url);
    await expect(
      page.getByRole("button", { name: "Relación: Activas" }),
    ).toBeVisible();
    expect(await exportCount(page)).toBe(n);

    await page.getByTestId("personas-exportar").click();
    const href = await page
      .getByRole("menuitem", { name: "CSV" })
      .getAttribute("href");
    expect(href).toContain("f=1*st.i.activa");
    expect(href).toContain("cols=");

    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    const lines = (await response.text())
      .replace(/^﻿/, "")
      .trim()
      .split(/\r?\n/);
    expect(lines.length - 1).toBe(n);
  });

  test("baja range, antigüedad and the baja columns reach «Exportar (N)»", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsDemoAdmin(page);
    await page.goto(
      "/app/personas?f=1*fb.b.20260101.20260630&cols=fechaBaja.tipoBaja.motivoBaja.antiguedad.finiquitoMonto",
    );

    await expect(
      page.getByRole("button", {
        name: "Fecha de baja: entre 01/01/2026 – 30/06/2026",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Motivo de baja" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Filtro", exact: true }).click();
    await page.getByRole("option", { name: "Antigüedad" }).click();
    await page.getByRole("button", { name: "5 años" }).click();
    await expect(page).toHaveURL(/an\.ya\.5/);
    await page.keyboard.press("Escape");

    const n = await exportCount(page);
    await page.getByTestId("personas-exportar").click();
    const href = await page
      .getByRole("menuitem", { name: "CSV" })
      .getAttribute("href");
    expect(href).toContain("fb.b.20260101.20260630");

    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    const lines = (await response.text())
      .replace(/^\uFEFF/, "")
      .trim()
      .split(/\r?\n/);
    // The demo admin has compensation:read: the finiquito column is there.
    expect(lines[0]).toContain("Fecha de baja");
    expect(lines[0]).toContain("Finiquito (monto)");
    expect(lines.length - 1).toBe(n);
  });

  test("old links keep working", async ({ page }) => {
    await loginAsDemoAdmin(page);
    await page.goto("/app/personas?status=baja");

    await expect(
      page.getByRole("button", { name: "Relación: Bajas" }),
    ).toBeVisible();
  });

  test("phones filter in a sheet with «Ver N personas»", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsDemoAdmin(page);
    await page.goto("/app/personas");

    await page.getByRole("button", { name: /^Filtros/ }).click();
    const sheet = page.getByRole("dialog", { name: "Filtros" });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /^Ver \d+ personas?$/ }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("heading", { name: "Baja", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });
});
