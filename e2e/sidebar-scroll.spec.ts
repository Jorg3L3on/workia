import { expect, test } from "@playwright/test";

import {
  loginAsDemoAdmin,
  loginAsDemoRrhh,
  readShellMetrics,
  stretchContentColumn,
} from "./shell-scroll";

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
    await loginAsDemoAdmin(page);
    await page.goto("/admin/rbac");
    await expect(
      page.getByRole("heading", { name: "Roles y permisos", level: 1 }),
    ).toBeVisible();

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
