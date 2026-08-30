import { expect, test } from "@playwright/test";

const loginAsDemoRrhh = async (page: import("@playwright/test").Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("rrhh@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const stretchContentColumn = async (page: import("@playwright/test").Page) => {
  await page.evaluate(() => {
    const scroller = document.querySelector('[data-slot="shell-main-scroll"]');
    if (!(scroller instanceof HTMLElement)) {
      return;
    }

    scroller.style.paddingBottom = "2200px";
  });
};

const readShellMetrics = async (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const sidebar = document.querySelector('[data-slot="sidebar-inner"]');
    const header = document.querySelector('[data-slot="sidebar-header"]');
    const footer = document.querySelector('[data-slot="sidebar-footer"]');
    const scroller = document.querySelector('[data-slot="shell-main-scroll"]');
    const topNav = document.querySelector('[data-slot="shell-top-nav"]');

    return {
      documentScroll: window.scrollY,
      mainScroll: scroller instanceof HTMLElement ? scroller.scrollTop : -1,
      sidebar: sidebar?.getBoundingClientRect().toJSON() ?? null,
      header: header?.getBoundingClientRect().toJSON() ?? null,
      footer: footer?.getBoundingClientRect().toJSON() ?? null,
      topNav: topNav?.getBoundingClientRect().toJSON() ?? null,
    };
  });

test.describe("Sidebar stays pinned while content scrolls", () => {
  test("keeps logo and user menu in view on Catálogo", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsDemoRrhh(page);
    await page.goto("/app/catalogo/sucursales");

    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(sidebar.getByRole("link", { name: "Áreas" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Puestos" })).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Sucursales" }),
    ).toBeVisible();

    await stretchContentColumn(page);

    const before = await readShellMetrics(page);
    expect(before.sidebar).toBeTruthy();
    expect(before.header?.top).toBeLessThan(20);
    expect(before.footer?.bottom).toBeGreaterThan(800);
    expect(before.documentScroll).toBe(0);

    await page.locator('[data-slot="shell-main-scroll"]').evaluate((node) => {
      node.scrollTop = 1400;
    });

    const after = await readShellMetrics(page);
    expect(after.documentScroll).toBe(0);
    expect(after.mainScroll).toBeGreaterThan(1000);
    expect(after.sidebar?.top).toBeCloseTo(before.sidebar?.top ?? -1, 0);
    expect(after.sidebar?.height).toBeCloseTo(before.sidebar?.height ?? -1, 0);
    expect(after.header?.top).toBeCloseTo(before.header?.top ?? -1, 0);
    expect(after.footer?.bottom).toBeCloseTo(before.footer?.bottom ?? -1, 0);
    expect(after.topNav?.top).toBeCloseTo(before.topNav?.top ?? -1, 0);
  });

  test("keeps admin chrome pinned on a tall page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill("admin@workia.local");
    await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/(app|admin)/, { timeout: 25_000 });
    await page.goto("/admin/rbac");

    await stretchContentColumn(page);

    const before = await readShellMetrics(page);
    await page.locator('[data-slot="shell-main-scroll"]').evaluate((node) => {
      node.scrollTop = 1400;
    });
    const after = await readShellMetrics(page);

    expect(after.documentScroll).toBe(0);
    expect(after.mainScroll).toBeGreaterThan(1000);
    expect(after.sidebar?.top).toBeCloseTo(before.sidebar?.top ?? -1, 0);
    expect(after.header?.top).toBeCloseTo(before.header?.top ?? -1, 0);
    expect(after.footer?.bottom).toBeCloseTo(before.footer?.bottom ?? -1, 0);
    expect(after.topNav?.top).toBeCloseTo(before.topNav?.top ?? -1, 0);
  });
});
