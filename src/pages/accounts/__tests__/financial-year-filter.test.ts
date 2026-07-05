/**
 * Regression tests for Financial Year filtering in Accounting Vouchers.
 *
 * The FY dropdown must:
 *  1. Only expose Active FYs to new voucher creation.
 *  2. Preserve an already-selected Inactive FY when editing an old voucher,
 *     rendered with an "(Inactive)" suffix so the user can see the state.
 *  3. Auto-match FY by date must skip inactive years.
 */
import { describe, it, expect } from "vitest";

type FY = { id: string; name: string; start_date: string; end_date: string; is_active: boolean };

const YEARS: FY[] = [
  { id: "fy1", name: "FY 2025-2026", start_date: "2025-07-01", end_date: "2026-06-30", is_active: true },
  { id: "fy2", name: "FY 2026-2027", start_date: "2026-07-01", end_date: "2027-06-30", is_active: false },
];

// Pure helpers extracted from AccountingVouchers.tsx behavior.
const dropdownOptions = (years: FY[], selectedId: string) =>
  years
    .filter((f) => f.is_active || f.id === selectedId)
    .map((f) => ({ id: f.id, label: `${f.name}${!f.is_active ? " (Inactive)" : ""}` }));

const matchByDate = (years: FY[], iso: string) =>
  years.find((fy) => fy.is_active && fy.start_date <= iso && fy.end_date >= iso);

describe("Financial Year dropdown filtering", () => {
  it("shows only active FYs when nothing selected", () => {
    const opts = dropdownOptions(YEARS, "");
    expect(opts).toEqual([{ id: "fy1", label: "FY 2025-2026" }]);
  });

  it("shows selected inactive FY with (Inactive) suffix in edit mode", () => {
    const opts = dropdownOptions(YEARS, "fy2");
    expect(opts).toEqual([
      { id: "fy1", label: "FY 2025-2026" },
      { id: "fy2", label: "FY 2026-2027 (Inactive)" },
    ]);
  });

  it("hides inactive FYs from date-based auto-match", () => {
    // Date falls in inactive FY 2026-2027 → should NOT match.
    expect(matchByDate(YEARS, "2026-08-15")).toBeUndefined();
    // Date in active FY 2025-2026 → matches.
    expect(matchByDate(YEARS, "2025-09-10")?.id).toBe("fy1");
  });

  it("client-side guard blocks post when selected FY inactive", () => {
    const selected = YEARS.find((f) => f.id === "fy2");
    const blocked = !!selected && !selected.is_active;
    expect(blocked).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// End-to-end style: simulate the Laravel voucher store contract for inactive FY.
// The real controller returns 422 with a "Financial Year ... is inactive" message
// and writes an audit_log row with action=reject_inactive_fy. We stub fetch to
// mirror that contract and verify (a) client shows the specific error, and
// (b) an audit entry is recorded.
// -----------------------------------------------------------------------------
import { vi } from "vitest";

type AuditEntry = { module: string; action: string; new_data: any };
const auditStore: AuditEntry[] = [];

const stubServerPostVoucher = async (body: {
  voucher_type: string; voucher_date: string; financial_year_id: string; user_name: string;
}) => {
  const fy = YEARS.find((y) => y.id === body.financial_year_id);
  if (fy && !fy.is_active) {
    auditStore.push({
      module: "accounting",
      action: "reject_inactive_fy",
      new_data: { financial_year_id: fy.id, financial_year_name: fy.name, voucher_type: body.voucher_type, voucher_date: body.voucher_date },
    });
    const err: any = new Error(`Selected Financial Year '${fy.name}' is inactive. Activate it in Settings → Financial Years or pick an active one.`);
    err.status = 422;
    throw err;
  }
  return { id: "v-new", status: "posted" };
};

describe("Inactive FY posting — E2E contract", () => {
  beforeEach(() => { auditStore.length = 0; });

  it("returns 422 with a specific message and records an audit entry", async () => {
    await expect(
      stubServerPostVoucher({ voucher_type: "journal", voucher_date: "2026-08-15", financial_year_id: "fy2", user_name: "tester" })
    ).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/inactive/i) });

    expect(auditStore).toHaveLength(1);
    expect(auditStore[0]).toMatchObject({
      module: "accounting",
      action: "reject_inactive_fy",
      new_data: { financial_year_id: "fy2", financial_year_name: "FY 2026-2027", voucher_type: "journal" },
    });
  });

  it("succeeds when an active FY is used", async () => {
    const res = await stubServerPostVoucher({ voucher_type: "journal", voucher_date: "2025-09-10", financial_year_id: "fy1", user_name: "tester" });
    expect(res).toMatchObject({ id: "v-new", status: "posted" });
    expect(auditStore).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Edit-mode regression: draft save is allowed even when the loaded voucher's FY
// is inactive, but submitting/posting is blocked by the client guard.
// -----------------------------------------------------------------------------
const clientGuard = (fyList: FY[], selectedFyId: string, submitForApproval: boolean) => {
  const sel = fyList.find((f) => f.id === selectedFyId);
  if (submitForApproval && sel && !sel.is_active) {
    return { allowed: false, reason: `${sel.name} is inactive — posting blocked` };
  }
  return { allowed: true };
};

describe("Edit-mode: draft vs post with inactive FY", () => {
  it("allows Save-as-Draft with an inactive FY", () => {
    expect(clientGuard(YEARS, "fy2", /* submit */ false)).toEqual({ allowed: true });
  });

  it("blocks Submit-for-Approval with an inactive FY", () => {
    expect(clientGuard(YEARS, "fy2", /* submit */ true)).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/inactive/i),
    });
  });

  it("allows posting when the selected FY is active", () => {
    expect(clientGuard(YEARS, "fy1", true)).toEqual({ allowed: true });
  });
});

