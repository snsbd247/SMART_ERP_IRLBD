import { test, expect } from "@playwright/test";

/**
 * Treasury Information — A-Challan print preview modal.
 *
 * Pure UI test: drives the print modal with a fake row by injecting a button
 * that mimics the page handlers. We avoid requiring auth/seed data so this
 * runs in any environment.
 */

const HARNESS_HTML = `
<!doctype html><html><body>
<button id="open" data-testid="print-challan-fake">Print</button>
<dialog id="modal" data-testid="challan-print-modal">
  <code data-testid="challan-print-url"></code>
  <button data-testid="challan-print-copy" aria-label="Copy challan print URL">Copy URL</button>
  <button data-testid="challan-print-open">Open Print Slip</button>
  <div role="status" aria-live="polite" data-testid="challan-copy-live"></div>
  <div data-testid="challan-popup-blocked" hidden role="alert">Popup blocked</div>
</dialog>
<script>
  const BASE = "http://achallan.gov.bd/acs/General/PrintChallanSlipDetails";
  const sanitize = (v) => String(v ?? "").trim().replace(/\\s+/g,"").replace(/\\/{2,}/g,"/").toUpperCase();
  const build = (v) => BASE + "?challanNo=" + encodeURIComponent(sanitize(v));
  const challan = "acs-2026/123";
  const url = build(challan);
  const modal = document.getElementById("modal");
  document.getElementById("open").onclick = () => {
    modal.querySelector("[data-testid=challan-print-url]").textContent = url;
    modal.show();
  };
  modal.querySelector("[data-testid=challan-print-copy]").onclick = async () => {
    const live = modal.querySelector("[data-testid=challan-copy-live]");
    try {
      await navigator.clipboard.writeText(url);
      live.textContent = "Challan print URL copied to clipboard.";
    } catch { live.textContent = "Copy failed."; }
  };
  modal.querySelector("[data-testid=challan-print-open]").onclick = () => {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    const blocked = modal.querySelector("[data-testid=challan-popup-blocked]");
    if (!w) blocked.hidden = false; else blocked.hidden = true;
  };
</script>
</body></html>`;

test.describe("Treasury A-Challan print preview", () => {
  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setContent(HARNESS_HTML);
  });

  test("renders normalized URL in modal", async ({ page }) => {
    await page.getByTestId("print-challan-fake").click();
    await expect(page.getByTestId("challan-print-modal")).toBeVisible();
    const url = await page.getByTestId("challan-print-url").textContent();
    expect(url).toBe(
      "http://achallan.gov.bd/acs/General/PrintChallanSlipDetails?challanNo=ACS-2026%2F123",
    );
  });

  test("Copy URL writes to clipboard and announces success", async ({ page }) => {
    await page.getByTestId("print-challan-fake").click();
    await page.getByTestId("challan-print-copy").click();
    await expect(page.getByTestId("challan-copy-live")).toHaveText(/copied/i);
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain("challanNo=ACS-2026%2F123");
  });

  test("Open Print Slip launches a new tab with the normalized URL", async ({ page, context }) => {
    await page.getByTestId("print-challan-fake").click();
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("challan-print-open").click(),
    ]);
    expect(popup.url()).toContain("achallan.gov.bd");
    expect(popup.url()).toContain("challanNo=ACS-2026%2F123");
    await popup.close();
  });

  test("popup blocker surfaces retry alert", async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-ignore
      window.open = () => null;
    });
    await page.setContent(HARNESS_HTML);
    await page.getByTestId("print-challan-fake").click();
    await page.getByTestId("challan-print-open").click();
    await expect(page.getByTestId("challan-popup-blocked")).toBeVisible();
  });
});
