import { test, expect } from "../playwright-fixture";

/**
 * Verifies the sidebar header renders cleanly when no company logo or
 * fallback icon is configured. Guards against regressions where removing
 * the logo would leave broken <img> tags or empty icon boxes behind.
 */
test.describe("Sidebar — no logo / no icon", () => {
  test("renders header with software name only", async ({ page }) => {
    await page.goto("/");

    const header = page.getByTestId("sidebar-header");
    await expect(header).toBeVisible({ timeout: 15_000 });

    // No <img> elements inside the header (no company logo).
    await expect(header.locator("img")).toHaveCount(0);

    // No SVG icon boxes used as logo fallback (e.g. Building2).
    await expect(header.locator("svg")).toHaveCount(0);

    // The software name text must still be present.
    const text = (await header.textContent())?.trim() || "";
    expect(text.length).toBeGreaterThan(0);
  });
});
