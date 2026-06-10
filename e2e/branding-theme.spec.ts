import { test, expect } from "../playwright-fixture";

/**
 * Branding theme persistence E2E.
 *
 * Verifies that:
 *   1. Changing Primary/Secondary colors on /admin/branding triggers a live preview.
 *   2. Saving sets the inline status indicator to "saved".
 *   3. After a full page reload (mimics refresh/login since the cache is hydrated
 *      on first paint before backend round-trip), the chosen colors are still
 *      applied to `:root` — i.e. the theme survives without re-saving.
 *
 * Real login/logout flow is gated behind TEST_USER_EMAIL / TEST_USER_PASSWORD
 * env vars so CI can run without seeded credentials.
 */

const NEW_PRIMARY = "210 90% 40%";   // vivid blue, very different from default green
const NEW_SECONDARY = "30 95% 55%";  // orange

async function getRootVar(page: any, name: string): Promise<string> {
  return await page.evaluate(
    (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );
}

test.describe("Branding & White-Label — theme persistence", () => {
  test("live preview, save indicator, and survives reload", async ({ page }) => {
    await page.goto("/admin/branding");

    // Page must render the Theme Colors section.
    await expect(page.getByText("Theme Colors")).toBeVisible({ timeout: 15_000 });

    // Locate the HSL text input next to "Primary Color".
    const primaryInput = page.locator('input[placeholder="221 83% 53%"]').first();
    const secondaryInput = page.locator('input[placeholder="220 14% 96%"]').first();

    await primaryInput.fill(NEW_PRIMARY);
    await secondaryInput.fill(NEW_SECONDARY);

    // 1. Live preview — :root --primary should update without saving.
    await expect.poll(() => getRootVar(page, "--primary")).toBe("210 90% 40%");

    // 2. Save and assert status indicator transitions.
    const status = page.getByTestId("save-status");
    await page.getByTestId("branding-save").click();
    await expect(status).toHaveAttribute("data-status", /saving|saved/, { timeout: 5_000 });
    await expect(status).toHaveAttribute("data-status", "saved", { timeout: 15_000 });

    // 3. Reload — cache should re-apply the same colors before backend responds.
    await page.reload();
    await expect.poll(() => getRootVar(page, "--primary"), { timeout: 10_000 })
      .toBe("210 90% 40%");
    await expect.poll(() => getRootVar(page, "--accent")).toBe("30 95% 55%");
  });

  test("logout + login preserves per-user theme", async ({ page }) => {
    const email = process.env.TEST_USER_EMAIL;
    const password = process.env.TEST_USER_PASSWORD;
    test.skip(!email || !password, "Set TEST_USER_EMAIL / TEST_USER_PASSWORD to run this scenario");

    // Assumes the previous test (or a seeded preference) saved NEW_PRIMARY for this user.
    await page.goto("/login");
    await page.locator('input[type="email"], input[name="email"]').first().fill(email!);
    await page.locator('input[type="password"]').first().fill(password!);
    await page.getByRole("button", { name: /sign in|log ?in/i }).click();

    await page.waitForLoadState("networkidle");
    await expect.poll(() => getRootVar(page, "--primary"), { timeout: 15_000 })
      .toBe("210 90% 40%");
  });
});
