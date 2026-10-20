import { expect, test, type Page } from "@playwright/test";

import {
  expectChromePinned,
  loginAsDemoAdmin,
  loginAsDemoRrhh,
  readShellMetrics,
  stretchContentColumn,
} from "./shell-scroll";

const WHEEL_DELTA = 600;

const rectOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });

type Point = { x: number; y: number };

/** Midpoints of the gaps between the inset edges and the centered column. */
const marginPoints = async (page: Page) => {
  const inset = await rectOf(page, '[data-slot="sidebar-inset"]');
  const column = await rectOf(page, '[data-slot="shell-content-column"]');
  const topNav = await rectOf(page, '[data-slot="shell-top-nav"]');
  const y = topNav.bottom + 200;

  expect(column.left - inset.left).toBeGreaterThan(40);
  expect(inset.right - column.right).toBeGreaterThan(40);

  return {
    left: { x: (inset.left + column.left) / 2, y },
    right: { x: (column.right + inset.right) / 2, y },
    column: { x: (column.left + column.right) / 2, y },
  };
};

const centerOf = async (page: Page, selector: string): Promise<Point> => {
  const rect = await rectOf(page, selector);
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
};

const resetScroll = (page: Page) =>
  page.locator('[data-slot="shell-main-scroll"]').evaluate((node) => {
    (node as HTMLElement).scrollTop = 0;
  });

/** Wheel at `point` and expect the shell scroller, not the document, to move. */
const expectWheelScrollsShell = async (page: Page, point: Point) => {
  await resetScroll(page);
  const before = await readShellMetrics(page);
  expect(before.mainScroll).toBe(0);
  expect(before.documentScroll).toBe(0);

  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, WHEEL_DELTA);

  await expect
    .poll(async () => (await readShellMetrics(page)).mainScroll)
    .toBeGreaterThan(0);

  const after = await readShellMetrics(page);
  expect(after.documentScroll).toBe(0);
  expectChromePinned(before, after);
};

const collapseSidebar = async (page: Page) => {
  await page.locator('[data-slot="sidebar-trigger"]').first().click();
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute(
    "data-state",
    "collapsed",
  );
};

const expandSidebar = async (page: Page) => {
  await page.locator('[data-slot="sidebar-trigger"]').first().click();
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute(
    "data-state",
    "expanded",
  );
};

const marginCases = (path: string) => {
  test("scrolls the content from the inset margins with the sidebar expanded", async ({
    page,
  }) => {
    await page.goto(path);
    await stretchContentColumn(page);

    const points = await marginPoints(page);
    await expectWheelScrollsShell(page, points.left);
    await expectWheelScrollsShell(page, points.right);
  });

  test("scrolls the content from the inset margins with the sidebar collapsed", async ({
    page,
  }) => {
    await page.goto(path);
    await stretchContentColumn(page);
    await collapseSidebar(page);

    const points = await marginPoints(page);
    await expectWheelScrollsShell(page, points.left);
    await expectWheelScrollsShell(page, points.right);
  });
};

const sidebarCases = (path: string) => {
  test("scrolls the content from the expanded sidebar", async ({ page }) => {
    await page.goto(path);
    await stretchContentColumn(page);

    await expectWheelScrollsShell(
      page,
      await centerOf(page, '[data-slot="sidebar-content"]'),
    );
    await expectWheelScrollsShell(
      page,
      await centerOf(page, '[data-slot="sidebar-header"]'),
    );
    await expectWheelScrollsShell(
      page,
      await centerOf(page, '[data-slot="sidebar-footer"]'),
    );
  });

  test("scrolls the content from the icon-collapsed sidebar", async ({
    page,
  }) => {
    await page.goto(path);
    await stretchContentColumn(page);
    await collapseSidebar(page);

    await expectWheelScrollsShell(
      page,
      await centerOf(page, '[data-slot="sidebar-container"]'),
    );

    await expandSidebar(page);
  });
};

test.describe("Wheel scrolls the shell from anywhere in the window", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test.describe("/app", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsDemoRrhh(page);
    });

    marginCases("/app/personas");
    sidebarCases("/app/personas");

    test("control: scrolls the content from the content column", async ({
      page,
    }) => {
      await page.goto("/app/personas");
      await stretchContentColumn(page);

      const points = await marginPoints(page);
      await expectWheelScrollsShell(page, points.column);
    });
  });

  test.describe("/admin", () => {
    test.beforeEach(async ({ page }) => {
      await loginAsDemoAdmin(page);
    });

    marginCases("/admin/rbac");
    sidebarCases("/admin/rbac");
  });
});
