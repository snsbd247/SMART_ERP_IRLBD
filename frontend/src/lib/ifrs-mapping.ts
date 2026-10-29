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

const LEGACY_IFRS_LINE_MAP: Record<string, IFRSLine> = {
  "revenue": "revenue",
  "total income": "revenue",
  "cost of sales": "cogs",
  "administrative expenses": "admin_expense",
  "operating expenses": "admin_expense",
  "selling and distribution expenses": "selling_expense",
  "distribution costs": "selling_expense",
  "finance costs": "financial_expense",
  "finance income": "other_income",
  "other income": "other_income",
  "income tax expense": "tax_provision",
  "current tax liabilities": "provision_income_tax",
  "deferred tax assets": "deferred_tax_asset",
  "property, plant and equipment": "ppe",
  "intangible assets": "intangible_asset",
  "inventories": "inventory",
  "current tax assets": "advance_income_tax",
  "advances, deposits and prepayments": "advance_deposit",
  "other current assets": "advance_deposit",
  "trade receivables": "accounts_receivable",
  "trade and other receivables": "accounts_receivable",
  "cash and cash equivalents": "cash_bank",
  "issued capital": "share_capital",
  "share capital": "share_capital",
  "total equity": "retained_earnings",
  "retained earnings": "retained_earnings",
  "revaluation reserve": "revaluation_reserve",
  "long-term borrowings": "long_term_loan",
  "total liabilities": "other_liability",
  "accrued expenses and other current liabilities": "other_liability",
  "other current liabilities": "other_liability",
  "employee benefit obligations": "other_liability",
  "trade payables": "accounts_payable",
  "trade and other payables": "accounts_payable",
  "short-term borrowings": "short_term_loan",
  "total assets": "advance_deposit",
};

export function normalizeIFRSLine(value: string | null | undefined): IFRSLine | null {
  if (!value) return null;
  const raw = String(value).trim();
  if ((IFRS_LINE_LABEL as Record<string, string>)[raw]) return raw as IFRSLine;
  return LEGACY_IFRS_LINE_MAP[raw.toLowerCase()] ?? null;
}

const has = (s: string, ...kw: string[]) => kw.some(k => s.includes(k));

// Direct code → IFRS line mapping for the Bangladesh standardized CoA.
// This takes precedence over keyword-based fallbacks.
const CODE_MAP: Record<string, IFRSLine> = {
  // ── Header / parent accounts (zero-balance but kept for completeness) ──
  "1000": "ppe", "1100": "ppe", "1200": "inventory",
  "2000": "other_liability", "2100": "long_term_loan", "2200": "short_term_loan",
  "3000": "retained_earnings",
  "4000": "revenue",
  "5000": "cogs", "5100": "cogs", "5200": "cogs", "5300": "cogs",
  "6000": "admin_expense", "6100": "admin_expense", "6200": "selling_expense",
  "6300": "financial_expense", "6400": "tax_provision",

  // ── Non-current assets (1100 group) ──
  "1101": "ppe",
  "1102": "intangible_asset",
  "1103": "deferred_tax_asset",
  "1104": "advance_deposit",        // Advance to Supplier
  "1105": "inventory",
  "1106": "advance_deposit",        // Prepaid Expenses
  "1107": "advance_income_tax",     // TDS Receivable
  "1111": "cash_bank", "1112": "cash_bank", "1113": "cash_bank", "1114": "cash_bank",

  // ── Current assets – fixed assets sub-codes (1200 group) ──
  "1201": "ppe", "1202": "ppe", "1203": "ppe", "1204": "ppe", "1205": "ppe",
  // Inventories
  "1210": "inventory", "1211": "inventory", "1212": "inventory",
  "1213": "inventory", "1214": "inventory", "1215": "inventory",
  // Advances
  "1220": "advance_income_tax",
  "1230": "advance_deposit", "1231": "advance_deposit", "1232": "advance_deposit",
  "1233": "advance_deposit", "1234": "advance_deposit",
  // Cash & Bank
  "1250": "cash_bank", "1251": "cash_bank", "1252": "cash_bank",
  "1253": "cash_bank", "1254": "cash_bank", "1255": "cash_bank", "1256": "cash_bank",

  // ── Liabilities ──
  "2101": "long_term_loan",
  "2102": "accounts_payable",       // Supplier Payable
  "2103": "other_liability",        // Accrued Expenses
  "2104": "vat_payable",
  "2105": "short_term_loan",
  "2106": "other_liability",        // Provident Fund Liability
  "2107": "other_liability",        // Savings Fund Liability
  "2201": "short_term_loan",        // Bank Loan
  "2202": "short_term_loan",        // Directors Loan
  "2220": "other_liability", "2221": "other_liability", "2222": "other_liability",
  "2223": "other_liability", "2224": "other_liability", "2225": "other_liability",
  "2226": "other_liability", "2227": "other_liability",
  "2228": "vat_payable",
  "2230": "short_term_loan", "2231": "short_term_loan", "2232": "short_term_loan",
  "2233": "short_term_loan", "2234": "short_term_loan", "2235": "short_term_loan",
  "2240": "provision_income_tax",

  // ── Equity ──
  "3101": "share_capital",
  "3102": "retained_earnings",
  "3103": "revaluation_reserve",

  // ── Income ──
  "4101": "revenue", "4102": "revenue", "4105": "revenue",
  "4103": "other_income", "4104": "other_income", "4201": "other_income",

  // ── COGS / Direct production (5xxx) ──
  "5101": "cogs", "5102": "cogs", "5103": "cogs",
  "5201": "cogs", "5202": "cogs", "5203": "cogs", "5204": "cogs",
  "5205": "selling_expense", "5206": "selling_expense",
  "5207": "cogs", "5208": "cogs", "5209": "cogs", "5210": "cogs",
  // Manufacturing overhead 5300-5399 are handled by range below.

  // ── Tax expense ──
  "6401": "tax_provision",
  "6402": "deferred_tax",
};

export function defaultMapping(
  account_name: string,
  account_type: string,
  account_code = ""
): IFRSLine {
  const n = (account_name || "").toLowerCase();
  const c = (account_code || "").toString().trim();

  // 1) Exact code match
  if (CODE_MAP[c]) return CODE_MAP[c];

  // 2) Range-based code rules (Bangladesh CoA) — covers any custom 4-digit code
  if (/^\d{4}$/.test(c)) {
    const num = parseInt(c, 10);
    // Assets
    if (num >= 1101 && num <= 1109) return "ppe";              // Non-current asset sub-codes
    if (num >= 1110 && num <= 1119) return "cash_bank";        // Non-current bank sub-codes
    if (num >= 1201 && num <= 1209) return "ppe";              // Fixed assets
    if (num >= 1210 && num <= 1219) return "inventory";
    if (num >= 1220 && num <= 1229) return "advance_income_tax";
    if (num >= 1230 && num <= 1239) return "advance_deposit";
    if (num >= 1240 && num <= 1249) return "accounts_receivable";
    if (num >= 1250 && num <= 1299) return "cash_bank";
    // Liabilities
    if (num >= 2101 && num <= 2109) return "long_term_loan";
    if (num >= 2201 && num <= 2209) return "short_term_loan";
    if (num >= 2210 && num <= 2219) return "accounts_payable";
    if (num >= 2220 && num <= 2229) return "other_liability";
    if (num >= 2230 && num <= 2239) return "short_term_loan";
    if (num >= 2240 && num <= 2249) return "provision_income_tax";
    // Equity
    if (num >= 3100 && num <= 3199) return "retained_earnings";
    // Income
    if (num >= 4100 && num <= 4199) return "revenue";
    if (num >= 4200 && num <= 4299) return "other_income";
    // Expenses
    if (num >= 5300 && num <= 5399) return "cogs";             // Manufacturing overhead
    if (num >= 5000 && num <= 5999) return "cogs";
    if (num >= 6100 && num <= 6199) return "admin_expense";
    if (num >= 6200 && num <= 6299) return "selling_expense";
    if (num >= 6300 && num <= 6399) return "financial_expense";
    if (num >= 6400 && num <= 6499) return "tax_provision";
  }


  // 3) Keyword fallback (legacy / custom accounts)
  if (account_type === "income") {
    if (has(n, "interest", "fdr", "other income", "gain", "discount received")) return "other_income";
    return "revenue";
  }

  if (account_type === "expense") {
    if (has(n, "deferred tax")) return "deferred_tax";
    if (has(n, "income tax", "tax provision", "current tax")) return "tax_provision";
    if (has(n, "cost of goods", "raw material", "factory", "manufacturing", "direct labour", "wages", "production", "consumption", "depreciation - factory", "factory overhead")) return "cogs";
    if (has(n, "selling", "distribution", "carton", "unloading", "delivery", "petrol", "diesel for cover", "freight outward", "cover van", "marketing", "transportation")) return "selling_expense";
    if (has(n, "interest on", "bank charge", "loan interest", "doc charge", "lc charge", "finance cost")) return "financial_expense";
    return "admin_expense";
  }

  if (account_type === "asset") {
    if (has(n, "deferred tax")) return "deferred_tax_asset";
    if (has(n, "cash", "bank", "fdr", "petty")) return "cash_bank";
    if (has(n, "receivable", "debtor", "accounts receivable", "trade receivable", "ar -")) return "accounts_receivable";
    if (has(n, "inventory", "stock", "raw material", "finished good", "work-in", "wip", "spare")) return "inventory";
    if (has(n, "advance income tax", "ait", "advance tax", "tds receivable")) return "advance_income_tax";
    if (has(n, "intangible", "software", "erp", "goodwill")) return "intangible_asset";
    if (has(n, "property", "plant", "equipment", "machinery", "building", "vehicle", "furniture", "land", "office equipment", "computer", "generator", "tool", "ppe", "fixed asset", "accumulated depreciation")) return "ppe";
    if (has(n, "advance", "deposit", "prepay", "l/c margin", "lc margin", "vat current")) return "advance_deposit";
    return "advance_deposit";
  }

  if (account_type === "liability") {
    if (has(n, "deferred tax")) return "deferred_tax_liability";
    if (has(n, "vat")) return "vat_payable";
    if (has(n, "provision for income tax", "income tax payable", "tax provision")) return "provision_income_tax";
    if (has(n, "long term", "long-term", "term loan", "ipdc", "ufl", "lease")) return "long_term_loan";
    if (has(n, "cc loan", "sod", "short term", "overdraft", "cash credit", "short-term", "bank loan", "directors loan")) return "short_term_loan";
    if (has(n, "payable", "creditor", "accounts payable", "trade payable", "supplier", "ap -")) return "accounts_payable";
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
