/**
 * Playwright smoke test for the AccountingVouchers "Curr Bal" line.
 *
 * Verifies the signed-balance convention (no Dr/Cr suffix, negative
 * shows leading "-") with stubbed Laravel API responses for both a
 * negative-balance and a positive-balance account.
 *
 * Run from project root (dev server must be up on :8080):
 *   bun add -d playwright
 *   bunx playwright install chromium
 *   bunx playwright test e2e/voucher-curr-bal.spec.ts
 *
 * The script restores a stored auth session from E2E_AUTH_STORAGE_KEY /
 * E2E_AUTH_SESSION_JSON env vars if present.
 */
import { test, expect, type Route } from "@playwright/test";

const APP_URL = process.env.APP_URL ?? "http://localhost:8080";

const STUB_ACCOUNTS = [
  {
    id: "acc-neg",
    account_code: "1025178216121",
    account_name: "IFIC Bank",
    account_type: "asset",
    parent_id: null,
    opening_balance: -16407762.86,
    opening_balance_type: "credit",
    is_active: true,
  },
  {
    id: "acc-pos",
    account_code: "1010101010",
    account_name: "Cash on Hand",
    account_type: "asset",
    parent_id: null,
    opening_balance: 20339216.76,
    opening_balance_type: "debit",
    is_active: true,
  },
];

async function stubApi(page: import("@playwright/test").Page) {
  await page.route("**/v1/db/chart_of_accounts*", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: STUB_ACCOUNTS }) }),
  );
  await page.route("**/v1/db/acc_vouchers*", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
  );
  await page.route("**/v1/db/voucher_entries*", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
  );
}

test.describe("AccountingVouchers · Curr Bal signed convention", () => {
  test("negative balance renders with leading '-' and no Dr/Cr", async ({ page, context }) => {
    const storageKey = process.env.E2E_AUTH_STORAGE_KEY;
    const session = process.env.E2E_AUTH_SESSION_JSON;

    await stubApi(page);
    await page.goto(APP_URL);
    if (storageKey && session) {
      await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [storageKey, session] as const);
    }
    await page.goto(`${APP_URL}/accounts/vouchers`);

    await page.getByRole("button", { name: /new voucher/i }).first().click();

    // Pick the negative-balance account in the first row's account combobox.
    await page.getByRole("combobox").first().click();
    await page.getByText(/IFIC Bank/).click();

    const currBal = page.locator("text=/Curr Bal/").first();
    await expect(currBal).toContainText(/-/);
    await expect(currBal).not.toContainText(/\bCr\b/);
    await expect(currBal).not.toContainText(/\bDr\b/);
  });

  test("positive balance renders without sign and no Dr/Cr", async ({ page }) => {
    await stubApi(page);
    await page.goto(`${APP_URL}/accounts/vouchers`);
    await page.getByRole("button", { name: /new voucher/i }).first().click();
    await page.getByRole("combobox").first().click();
    await page.getByText(/Cash on Hand/).click();

    const currBal = page.locator("text=/Curr Bal/").first();
    const text = (await currBal.textContent()) ?? "";
    expect(text).not.toMatch(/^Curr Bal :\s*-/);
    expect(text).not.toMatch(/\b(Dr|Cr)\b/);
  });
});
