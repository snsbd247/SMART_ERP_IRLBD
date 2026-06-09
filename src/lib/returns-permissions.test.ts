import { describe, it, expect } from "vitest";

/**
 * Role-gated end-to-end transitions for the Purchase → Return workflow.
 * Verifies that each stage requires the correct permission as well as
 * the correct upstream document state.
 */

type Role = "super_admin" | "purchase_manager" | "accountant" | "viewer" | "guest";
type Perm = "purchase.view" | "purchase.edit" | "purchase.approve" | "purchase.return";

const ROLE_PERMS: Record<Role, Perm[]> = {
  super_admin:       ["purchase.view", "purchase.edit", "purchase.approve", "purchase.return"],
  purchase_manager:  ["purchase.view", "purchase.edit", "purchase.approve", "purchase.return"],
  accountant:        ["purchase.view", "purchase.edit"],
  viewer:            ["purchase.view"],
  guest:             [],
};

const can = (role: Role, perm: Perm) => ROLE_PERMS[role].includes(perm);

type Stage = "requisition" | "po" | "grn" | "bill" | "return";
const REQUIRED_PERM: Record<Stage, Perm> = {
  requisition: "purchase.edit",
  po:          "purchase.approve",
  grn:         "purchase.edit",
  bill:        "purchase.edit",
  return:      "purchase.return",
};

interface Doc { stage: Stage; status: string; ref?: string }

const NEXT_STATUS: Record<Stage, string[]> = {
  requisition: ["approved"],
  po:          ["issued"],
  grn:         ["received"],
  bill:        ["billed"],
  return:      ["draft", "approved"],
};

const VALID_NEXT: Record<Stage, Stage[]> = {
  requisition: ["po"],
  po:          ["grn"],
  grn:         ["bill", "return"],
  bill:        ["return"],
  return:      [],
};

function advance(role: Role, from: Doc, to: Stage): Doc {
  if (!can(role, REQUIRED_PERM[to])) throw new Error(`PERM_DENIED:${to}`);
  if (!VALID_NEXT[from.stage].includes(to)) throw new Error(`BAD_STATE:skip ${from.stage}->${to}`);
  if (!NEXT_STATUS[from.stage].includes(from.status))
    throw new Error(`BAD_STATE:${from.stage}=${from.status}`);
  return { stage: to, status: "draft", ref: `${from.stage}-1` };
}

describe("returns workflow — role-gated transitions", () => {
  it("super_admin completes full flow PR→PO→GRN→Bill→Return", () => {
    let doc: Doc = { stage: "requisition", status: "approved" };
    doc = advance("super_admin", doc, "po");        expect(doc.stage).toBe("po");
    doc = { ...doc, status: "issued" };
    doc = advance("super_admin", doc, "grn");       expect(doc.stage).toBe("grn");
    doc = { ...doc, status: "received" };
    doc = advance("super_admin", doc, "bill");      expect(doc.stage).toBe("bill");
    doc = { ...doc, status: "billed" };
    doc = advance("super_admin", doc, "return");    expect(doc.stage).toBe("return");
  });

  it("purchase_manager can create + return", () => {
    const doc: Doc = { stage: "bill", status: "billed" };
    expect(() => advance("purchase_manager", doc, "return")).not.toThrow();
  });

  it("accountant cannot approve PO or create Return", () => {
    const pr: Doc = { stage: "requisition", status: "approved" };
    expect(() => advance("accountant", pr, "po")).toThrow(/PERM_DENIED:po/);
    const bill: Doc = { stage: "bill", status: "billed" };
    expect(() => advance("accountant", bill, "return")).toThrow(/PERM_DENIED:return/);
  });

  it("viewer is read-only at every stage", () => {
    const stages: [Doc, Stage][] = [
      [{ stage: "requisition", status: "approved" }, "po"],
      [{ stage: "po", status: "issued" }, "grn"],
      [{ stage: "grn", status: "received" }, "bill"],
      [{ stage: "bill", status: "billed" }, "return"],
    ];
    for (const [doc, next] of stages) {
      expect(() => advance("viewer", doc, next)).toThrow(/PERM_DENIED/);
    }
  });

  it("guest is blocked even from viewing", () => {
    expect(can("guest", "purchase.view")).toBe(false);
  });

  it("rejects skipping stages even with full perms", () => {
    const pr: Doc = { stage: "requisition", status: "approved" };
    // Cannot jump PR → GRN
    expect(() => advance("super_admin", pr, "grn")).toThrow(/BAD_STATE/);
  });
});
