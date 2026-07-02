import { Page, expect, Download } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

/**
 * Reusable helpers for HRM Bulk Import E2E tests.
 * Works against the BulkImportDialog harness (see harness.ts) or the real page.
 */

export interface BulkImportPageConfig {
  /** Human name — used in test titles. */
  name: string;
  /** DB table name — matches BulkImportConfig.table. */
  table: string;
  /** Ordered CSV column labels (matching BulkColumn.label). */
  headers: string[];
  /** Valid rows (arrays aligned with headers). */
  validRows: string[][];
  /** Invalid rows + the expected per-row error substring. */
  invalidRows: Array<{ row: string[]; expectedError: string | RegExp }>;
  /** Optional helper for the "server rejects specific row" simulation. */
  serverRejectRow?: { row: string[]; expectedError: string | RegExp };
}

export async function writeCsvFixture(config: {
  headers: string[];
  rows: string[][];
  filename: string;
}): Promise<string> {
  const escape = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = [config.headers, ...config.rows]
    .map((r) => r.map(escape).join(","))
    .join("\n");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bulk-import-"));
  const p = path.join(dir, config.filename);
  fs.writeFileSync(p, csv, "utf8");
  return p;
}

export async function uploadCsv(page: Page, csvPath: string) {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles(csvPath);
}

export async function expectRowError(
  page: Page,
  rowNum: number,
  expected: string | RegExp,
) {
  const row = page.locator(`tr:has(td:has-text("${rowNum}"))`).first();
  await expect(row).toContainText(expected as any);
}

export async function expectValidRow(page: Page, rowNum: number) {
  const row = page.locator(`tr:has(td:has-text("${rowNum}"))`).first();
  await expect(row).toContainText("OK");
}

export async function startImport(page: Page) {
  await page.getByRole("button", { name: /Import \d+ row/ }).click();
}

export async function cancelDuringImport(page: Page) {
  const progress = page.getByTestId("bulk-import-progress");
  await expect(progress).toBeVisible();
  await page.getByTestId("bulk-import-cancel").click();
}

export async function assertProgressUpdates(page: Page) {
  const progress = page.getByTestId("bulk-import-progress");
  await expect(progress).toBeVisible();
  // Progress text format: "Importing X / Y (NN%)"
  const first = await progress.innerText();
  await expect
    .poll(async () => await progress.innerText(), { timeout: 5000 })
    .not.toBe(first);
}

export async function downloadErrorCsv(page: Page): Promise<Download> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Download Errors CSV/i }).click(),
  ]);
  return download;
}

export async function readDownloadText(download: Download): Promise<string> {
  const p = await download.path();
  return p ? fs.readFileSync(p, "utf8") : "";
}

export function parseErrorCsv(text: string): {
  headers: string[];
  rows: string[][];
} {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const split = (l: string) => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (inQ) {
        if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ",") { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = split(lines[0]);
  return { headers, rows: lines.slice(1).map(split) };
}
