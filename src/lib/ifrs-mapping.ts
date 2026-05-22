// IFRS Financial Statement line-item taxonomy + default account mapping.
// Used by the IFRS Financial Statements report.

export type IFRSLine =
  // P&L
  | "revenue" | "cogs" | "admin_expense" | "selling_expense"
  | "financial_expense" | "other_income" | "tax_provision" | "deferred_tax"
  // Non-current assets
  | "ppe" | "intangible_asset" | "deferred_tax_asset"
  // Current assets
  | "inventory" | "advance_income_tax" | "advance_deposit"
  | "accounts_receivable" | "cash_bank"
  // Equity
  | "share_capital" | "retained_earnings" | "revaluation_reserve"
  // Non-current liabilities
  | "long_term_loan" | "deferred_tax_liability"
  // Current liabilities
  | "accounts_payable" | "other_liability" | "short_term_loan"
  | "provision_income_tax" | "vat_payable";

export const IFRS_LINE_LABEL: Record<IFRSLine, string> = {
  revenue: "Revenue",
  cogs: "Cost of Goods Sold",
  admin_expense: "Administrative Expenses",
  selling_expense: "Selling & Distribution Expenses",
  financial_expense: "Financial Expenses",
  other_income: "Other Income",
  tax_provision: "Provision for Income Tax",
  deferred_tax: "Deferred Tax (Expense)/Income",
  ppe: "Property, Plant & Equipment",
  intangible_asset: "Intangible Assets",
  deferred_tax_asset: "Deferred Tax Assets",
  inventory: "Inventories",
  advance_income_tax: "Advance Income Tax",
  advance_deposit: "Advance, Deposit & Prepayments",
  accounts_receivable: "Accounts Receivable",
  cash_bank: "Cash & Bank Balances",
  share_capital: "Share Capital",
  retained_earnings: "Retained Earnings",
  revaluation_reserve: "Revaluation Reserve",
  long_term_loan: "Long Term Loan",
  deferred_tax_liability: "Deferred Tax Liability",
  accounts_payable: "Accounts & Other Payable",
  other_liability: "Other Liabilities",
  short_term_loan: "Short Term Loans & Borrowings",
  provision_income_tax: "Provision for Income Tax",
  vat_payable: "VAT Current Account",
};

const has = (s: string, ...kw: string[]) => kw.some(k => s.includes(k));

export function defaultMapping(
  account_name: string,
  account_type: string,
  account_code = ""
): IFRSLine {
  const n = (account_name || "").toLowerCase();
  const c = (account_code || "").toString();

  if (account_type === "income") {
    if (has(n, "interest", "fdr", "other income", "gain", "discount received")) return "other_income";
    return "revenue";
  }

  if (account_type === "expense") {
    if (has(n, "deferred tax")) return "deferred_tax";
    if (has(n, "income tax", "tax provision", "current tax")) return "tax_provision";
    if (has(n, "cost of goods", "raw material", "factory", "manufacturing", "direct labour", "wages", "production", "consumption", "depreciation - factory", "factory overhead")) return "cogs";
    if (has(n, "selling", "distribution", "carton", "unloading", "delivery", "petrol", "diesel for cover", "freight outward", "cover van")) return "selling_expense";
    if (has(n, "interest on", "bank charge", "loan interest", "doc charge", "lc charge", "finance cost")) return "financial_expense";
    return "admin_expense";
  }

  if (account_type === "asset") {
    if (has(n, "deferred tax")) return "deferred_tax_asset";
    if (has(n, "cash", "bank", "fdr", "petty")) return "cash_bank";
    if (has(n, "receivable", "debtor", "accounts receivable", "trade receivable")) return "accounts_receivable";
    if (has(n, "inventory", "stock", "raw material", "finished good", "work-in", "wip", "spare")) return "inventory";
    if (has(n, "advance income tax", "ait", "advance tax")) return "advance_income_tax";
    if (has(n, "intangible", "software", "erp", "goodwill")) return "intangible_asset";
    if (has(n, "property", "plant", "equipment", "machinery", "building", "vehicle", "furniture", "land", "office equipment", "computer", "generator", "tool", "ppe", "fixed asset")) return "ppe";
    if (has(n, "advance", "deposit", "prepay", "l/c margin", "lc margin")) return "advance_deposit";
    return "advance_deposit";
  }

  if (account_type === "liability") {
    if (has(n, "deferred tax")) return "deferred_tax_liability";
    if (has(n, "vat")) return "vat_payable";
    if (has(n, "provision for income tax", "income tax payable", "tax provision")) return "provision_income_tax";
    if (has(n, "long term", "long-term", "term loan", "ipdc", "ufl", "lease")) return "long_term_loan";
    if (has(n, "cc loan", "sod", "short term", "overdraft", "cash credit", "short-term")) return "short_term_loan";
    if (has(n, "payable", "creditor", "accounts payable", "trade payable", "supplier")) return "accounts_payable";
    return "other_liability";
  }

  if (account_type === "equity") {
    if (has(n, "share capital", "paid up", "paid-up", "ordinary share")) return "share_capital";
    if (has(n, "reserve", "revaluation", "surplus")) return "revaluation_reserve";
    return "retained_earnings";
  }

  return "other_liability";
}

// Section groupings
export const PL_SECTIONS = {
  revenue: ["revenue"] as IFRSLine[],
  cogs: ["cogs"] as IFRSLine[],
  op_expense: ["admin_expense", "selling_expense", "financial_expense"] as IFRSLine[],
  other_income: ["other_income"] as IFRSLine[],
  tax: ["tax_provision", "deferred_tax"] as IFRSLine[],
};

export const BS_SECTIONS = {
  non_current_assets: ["ppe", "intangible_asset", "deferred_tax_asset"] as IFRSLine[],
  current_assets: ["inventory", "advance_income_tax", "advance_deposit", "accounts_receivable", "cash_bank"] as IFRSLine[],
  equity: ["share_capital", "retained_earnings", "revaluation_reserve"] as IFRSLine[],
  non_current_liabilities: ["long_term_loan", "deferred_tax_liability"] as IFRSLine[],
  current_liabilities: ["accounts_payable", "other_liability", "short_term_loan", "provision_income_tax", "vat_payable"] as IFRSLine[],
};

// Sign convention for display: P&L positive = revenue/credit; expenses positive = debit.
// Use absolute presentation, with sign already normalized when building rows.
