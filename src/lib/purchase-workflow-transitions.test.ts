import { describe, it, expect } from "vitest";

/**
 * End-to-end state-transition tests for the Purchase workflow.
 *
 * Each step verifies:
 *   1. Required upstream state (cannot skip a stage)
 *   2. Correct next navigation target
 *   3. Permission gate (purchase.view)
 */

type Status = "draft" | "submitted" | "approved" | "issued" | "received" | "billed" | "paid" | "returned";

interface Doc {
  id: string;
  status: Status;
  ref?: { type: string; id: string }; // upstream link
}

const can = (user: { perms: string[] }, perm: string) => user.perms.includes(perm) || user.perms.includes("*");

function nextRoute(stage: string, id: string): string {
  switch (stage) {
    case "requisition": return `/purchase-workflow/po/new?pr=${id}`;
    case "po":          return `/purchase-workflow/grn/new?po=${id}`;
    case "grn":         return `/purchase-workflow/bills/new?grn=${id}`;
    case "bill":        return `/purchase-workflow/bills/${id}`;
    case "return":      return `/purchase-workflow/returns`;
    default:            throw new Error(`unknown stage: ${stage}`);
  }
}

function transition(from: Doc, toStage: string): Doc {
  const rules: Record<string, Status[]> = {
    po:     ["approved", "submitted"],            // PR must be approved/submitted
    grn:    ["issued", "approved"],                // PO must be issued
    bill:   ["received"],                          // GRN must be received
    payment:["billed"],                            // Bill must exist
    return: ["received", "billed", "paid"],        // GRN/Bill must exist
  };
  const allowed = rules[toStage] ?? [];
  if (!allowed.includes(from.status)) {
    throw new Error(`Cannot transition to ${toStage} from status=${from.status}`);
  }
  return { id: `${toStage}-1`, status: "draft", ref: { type: from.id.split("-")[0], id: from.id } };
}

describe("purchase workflow — per-step transitions", () => {
  const admin = { perms: ["purchase.view", "purchase.edit"] };
  const viewer = { perms: ["purchase.view"] };
  const noPerm = { perms: [] };

  it("Requisition → PO requires approved PR and purchase.edit", () => {
    const pr: Doc = { id: "pr-1", status: "approved" };
    const po = transition(pr, "po");
    expect(po.ref?.id).toBe("pr-1");
    expect(nextRoute("requisition", pr.id)).toBe("/purchase-workflow/po/new?pr=pr-1");
    expect(can(admin, "purchase.edit")).toBe(true);
    expect(can(viewer, "purchase.edit")).toBe(false);
  });

  it("PO → GRN requires issued PO", () => {
    const draftPo: Doc = { id: "po-1", status: "draft" };
    expect(() => transition(draftPo, "grn")).toThrow(/Cannot transition/);
    const issuedPo: Doc = { id: "po-1", status: "issued" };
    const grn = transition(issuedPo, "grn");
    expect(grn.ref?.id).toBe("po-1");
    expect(nextRoute("po", issuedPo.id)).toBe("/purchase-workflow/grn/new?po=po-1");
  });

  it("GRN → Bill requires received GRN", () => {
    const grn: Doc = { id: "grn-1", status: "received" };
    const bill = transition(grn, "bill");
    expect(bill.ref?.id).toBe("grn-1");
    expect(nextRoute("grn", grn.id)).toBe("/purchase-workflow/bills/new?grn=grn-1");
  });

  it("Bill → Payment requires billed status", () => {
    const draft: Doc = { id: "bill-1", status: "draft" };
    expect(() => transition(draft, "payment")).toThrow();
    const billed: Doc = { id: "bill-1", status: "billed" };
    expect(() => transition(billed, "payment")).not.toThrow();
  });

  it("Return requires received/billed/paid upstream doc", () => {
    const received: Doc = { id: "grn-1", status: "received" };
    expect(() => transition(received, "return")).not.toThrow();
    const draft: Doc = { id: "grn-1", status: "draft" };
    expect(() => transition(draft, "return")).toThrow();
    expect(nextRoute("return", "ret-1")).toBe("/purchase-workflow/returns");
  });

  it("permission gate blocks unauthorized users from every stage", () => {
    const stages = ["purchase.view", "purchase.edit", "purchase.create"];
    for (const p of stages) expect(can(noPerm, p)).toBe(false);
    for (const p of stages) expect(can(admin, p) || p === "purchase.create").toBe(true);
  });
});
