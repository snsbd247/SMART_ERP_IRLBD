import { test, expect } from "@playwright/test";
import { BULK_HARNESS_HTML } from "./helpers/bulk-import-harness";
import { HRM_BULK_PAGES } from "./helpers/bulk-import-fixtures";
import {
  writeCsvFixture,
  uploadCsv,
  expectRowError,
  expectValidRow,
  startImport,
  cancelDuringImport,
  downloadErrorCsv,
  readDownloadText,
  parseErrorCsv,
} from "./helpers/bulk-import";

/**
 * Full E2E coverage for all 8 HRM bulk import pages.
 *
 * Uses a self-contained harness that mirrors the BulkImportDialog contract
 * (same test-ids, same DOM shape, same error-CSV format). This lets the
 * suite run in any environment without needing seeded auth. The same
 * helpers work against the real dialog when pointed at a live page.
 */

for (const config of HRM_BULK_PAGES) {
  test.describe(`Bulk Import — ${config.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setContent(BULK_HARNESS_HTML);
    });

    test("parses valid CSV and imports all rows successfully", async ({ page }) => {
      const csv = await writeCsvFixture({
        headers: config.headers,
        rows: config.validRows,
        filename: `${config.table}-valid.csv`,
      });
      await uploadCsv(page, csv);
      for (let i = 0; i < config.validRows.length; i++) {
        await expectValidRow(page, i + 2);
      }
      await startImport(page);
      await expect(page.locator("#result-summary")).toContainText(
        `${config.validRows.length} imported, 0 failed`,
      );
    });

    test("flags row-level validation errors with column-specific messages", async ({ page }) => {
      const rows = [...config.validRows, ...config.invalidRows.map((r) => r.row)];
      const csv = await writeCsvFixture({
        headers: config.headers,
        rows,
        filename: `${config.table}-mixed.csv`,
      });
      await uploadCsv(page, csv);
      for (let i = 0; i < config.validRows.length; i++) {
        await expectValidRow(page, i + 2);
      }
      for (let i = 0; i < config.invalidRows.length; i++) {
        const rowNum = config.validRows.length + i + 2;
        await expectRowError(page, rowNum, config.invalidRows[i].expectedError);
      }
    });

    test("exports failed-row CSV with error reasons per row", async ({ page }) => {
      if (!config.serverRejectRow) test.skip();
      const badRow = config.serverRejectRow!.row;
      const rejectToken = badRow[0];
      // Reload harness with server-reject filter
      await page.goto(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          BULK_HARNESS_HTML.replace(
            'const rejectSubstr = params.get("reject") || "";',
            `const rejectSubstr = ${JSON.stringify(rejectToken)};`,
          ),
        )}`,
      );

      const rows = [...config.validRows, badRow];
      const csv = await writeCsvFixture({
        headers: config.headers,
        rows,
        filename: `${config.table}-server-reject.csv`,
      });
      await uploadCsv(page, csv);
      await startImport(page);
      await expect(page.locator("#result-summary")).toContainText(/1 failed/);

      const dl = await downloadErrorCsv(page);
      const text = await readDownloadText(dl);
      const parsed = parseErrorCsv(text);
      expect(parsed.headers).toContain("Error");
      expect(parsed.headers).toContain("Row #");
      expect(parsed.rows).toHaveLength(1);
      const errCol = parsed.headers.indexOf("Error");
      expect(parsed.rows[0][errCol]).toMatch(config.serverRejectRow!.expectedError);
    });

    test("progress indicator updates and cancel halts chunked import mid-run", async ({ page }) => {
      // Slow down chunks so cancel lands mid-run.
      await page.goto(
        `data:text/html;charset=utf-8,${encodeURIComponent(BULK_HARNESS_HTML)}?chunk=1&delay=250`,
      );
      // The query string is stripped from data: URLs — re-inject via replace.
      await page.setContent(
        BULK_HARNESS_HTML.replace(
          'const chunkSize = parseInt(params.get("chunk") || "2", 10);',
          "const chunkSize = 1;",
        ).replace(
          'const chunkDelayMs = parseInt(params.get("delay") || "60", 10);',
          "const chunkDelayMs = 250;",
        ),
      );

      // Need enough rows to observe mid-run cancel.
      const many = Array.from({ length: 8 }, (_, i) => {
        const base = [...config.validRows[0]];
        base[0] = `${base[0]}-${i + 1}`;
        return base;
      });
      const csv = await writeCsvFixture({
        headers: config.headers,
        rows: many,
        filename: `${config.table}-cancel.csv`,
      });
      await uploadCsv(page, csv);
      await startImport(page);

      const progress = page.getByTestId("bulk-import-progress");
      await expect(progress).toBeVisible();
      const firstText = await progress.innerText();
      await cancelDuringImport(page);

      await expect(page.locator("#result-summary")).toContainText(/cancelled/i);
      const summary = await page.locator("#result-summary").innerText();
      const importedMatch = summary.match(/^(\d+) imported/);
      const imported = importedMatch ? parseInt(importedMatch[1], 10) : many.length;
      expect(imported).toBeLessThan(many.length);
      expect(firstText).toMatch(/Importing \d+ \/ \d+/);
    });
  });
}
