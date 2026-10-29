import { test, expect } from "@playwright/test";

/**
 * E2E: As a Super Admin, permanently deleting a soft-deleted voucher from the
 * Trash view must remove it from the system — it cannot be restored.
 *
 * Requires:
 *   TEST_SUPER_ADMIN_EMAIL / TEST_SUPER_ADMIN_PASSWORD env vars,
 *   and at least one soft-deleted voucher visible in the Trash list.
 */
test.describe("Voucher permanent delete", () => {
  test.skip(
    !process.env.TEST_SUPER_ADMIN_EMAIL || !process.env.TEST_SUPER_ADMIN_PASSWORD,
    "Set TEST_SUPER_ADMIN_EMAIL / TEST_SUPER_ADMIN_PASSWORD to run"
  );

  test("super admin can permanently delete from Trash and it does not come back", async ({ page }) => {
    // 1) Login as super admin.
    await page.goto("/login");
    await page.getByLabel(/username/i).fill(process.env.TEST_SUPER_ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_SUPER_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/");

    // 2) Open Accounting Vouchers and switch to Trash view.
    await page.goto("/accounting/vouchers");
    await page.getByRole("button", { name: /show deleted|showing trash/i }).click();

    // 3) Capture the first deleted voucher number.
    const firstRow = page.locator("table tbody tr").first();
    await expect(firstRow).toBeVisible();
    const voucherNumber = (await firstRow.locator("td").first().textContent())?.trim() || "";
    expect(voucherNumber).not.toBe("");

    // 4) Click Permanent Delete (destructive trash icon) on that row.
    await firstRow.getByRole("button", { name: /permanently delete voucher/i }).click();

    // 5) Confirmation dialog appears — provide reason and confirm.
    await expect(page.getByText(/permanently delete voucher/i)).toBeVisible();
    await page.getByPlaceholder(/reason|enter reason/i).fill("E2E permanent delete test");
    await page.getByRole("button", { name: /delete permanently/i }).click();

    // 6) Toast confirms permanent deletion.
    await expect(page.getByText(/voucher permanently deleted/i)).toBeVisible();

    // 7) Verify it is gone from Trash (cannot be restored).
    await page.reload();
    await page.getByRole("button", { name: /show deleted|showing trash/i }).click();
    await expect(page.locator("table tbody")).not.toContainText(voucherNumber);

    // 8) Also verify it is not in the active list.
    await page.getByRole("button", { name: /showing trash|show deleted/i }).click();
    await expect(page.locator("table tbody")).not.toContainText(voucherNumber);
  });
});
