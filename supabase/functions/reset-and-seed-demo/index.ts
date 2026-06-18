// Reset all transactional+master data and seed a FULL YEAR of operational demo data
// covering every module and every key ledger. Super-admin only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Deterministic RNG so re-runs are reproducible.
let _s = 42;
const R = () => { _s|=0; _s=(_s+0x6D2B79F5)|0; let t=Math.imul(_s^(_s>>>15),1|_s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
const RI = (a:number,b:number) => Math.floor(R()*(b-a+1))+a;
const pick = <T,>(a:T[]):T => a[Math.floor(R()*a.length)];
const pickN = <T,>(a:T[], n:number):T[] => { const c=[...a],o:T[]=[]; for(let i=0;i<n&&c.length;i++) o.push(c.splice(Math.floor(R()*c.length),1)[0]); return o; };
const U = () => crypto.randomUUID();
const ymd = (d:Date) => d.toISOString().slice(0,10);
const round2 = (n:number) => Math.round(n*100)/100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let MODE: "reset" | "reset-and-seed" | "transactions" = "reset-and-seed";
  try {
    const b = await req.clone().json();
    if (b?.mode === "reset") MODE = "reset";
    else if (b?.mode === "transactions") MODE = "transactions";
  } catch {}
  const log: string[] = [];
  const t0 = Date.now();
  try {
    _s = 42; // reset RNG
    const url = Deno.env.get("SUPABASE_URL")!;
    const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) throw new Error("Missing authorization");
    const u = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: ae } = await u.auth.getUser();
    if (ae || !user) throw new Error("Unauthorized");
    const db = createClient(url, svc);
    const { data: prof } = await db.from("profiles").select("employee_id").eq("id", user.id).single();
    if (prof?.employee_id) throw new Error("Super Admin only");
    const UID = user.id;

    // ===== TRANSACTIONS-ONLY RESET =====
    // Wipe only transactional rows; preserve ALL masters (customers, suppliers,
    // products, item_master, employees, salary_structures, BOMs) AND configuration
    // (CoA, branches, financial_years, units, categories, warehouses, departments,
    // designations, leave_types, company_settings, users, roles, page_shortcuts,
    // document numbering, branding).
    if (MODE === "transactions") {
      const txnGroups: string[][] = [
        // Purchase v2 child rows first
        ["lc_charges","purchase_return_items_v2","supplier_payment_allocations","supplier_bill_items_v2","grn_items_v2","po_amendments_v2","po_pr_links","purchase_order_items_v2","purchase_requisition_items","purchase_approval_history","purchase_audit_log"],
        ["purchase_returns_v2","supplier_payments_v2","supplier_bills_v2","grns_v2","lc_documents"],
        ["purchase_orders_v2","purchase_requisitions"],
        // Leaf child rows
        ["voucher_entries","payment_allocations","sales_invoice_items","sales_return_items","stock_movements","stock_ledger","stock_transfers","production_materials","fund_transactions","overtime_records","leave_requests","attendance","biometric_logs","payroll","party_notes","login_logs","backup_history","messages","conversation_participants",
          "tds_entries","invoice_payments","invoice_challans","sales_invoice_items_v2","customer_receives","ho_receives","vat_challan_items","purchase_order_items","invoice_status_logs","po_amendments","stock_adjustments","physical_stock_items","stock_damage_items","consumption_items"],
        ["sales_returns","physical_stock_entries","stock_damage_entries","consumption_entries","finished_goods_entries"],
        ["sales_invoices_v2","delivery_challans","vat_challans","purchase_orders"],
        ["acc_vouchers","party_payments","sales_invoices","production_entries","conversations","number_sequences"],
      ];
      for (const grp of txnGroups) {
        for (const t of grp) {
          const { error } = await db.from(t).delete().not("id", "is", null);
          if (error) log.push(`del ${t}: ${error.message}`);
        }
      }
      await db.from("audit_log").insert({
        user_id: UID, user_name: user.email,
        action: "demo_reset_transactions_only", module: "backup",
        details: `Transactional data wiped (masters & configuration preserved) in ${Date.now() - t0}ms`,
      });
      return new Response(JSON.stringify({
        success: true,
        mode: "transactions",
        message: "Transactional data cleared. Masters & configuration preserved.",
        elapsedMs: Date.now() - t0,
        log,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ===== RESET (full wipe incl. masters) =====
    const resetGroups: string[][] = [
      // Purchase v2 child rows first (must precede suppliers / items)
      ["lc_charges","purchase_return_items_v2","supplier_payment_allocations","supplier_bill_items_v2","grn_items_v2","po_amendments_v2","po_pr_links","purchase_order_items_v2","purchase_requisition_items","purchase_approval_history","purchase_audit_log"],
      ["purchase_returns_v2","supplier_payments_v2","supplier_bills_v2","grns_v2","lc_documents"],
      ["purchase_orders_v2","purchase_requisitions"],
      // Leaf child rows first
      ["voucher_entries","payment_allocations","sales_invoice_items","sales_return_items","stock_movements","stock_ledger","stock_transfers","production_materials","bom_items","fund_transactions","employee_fund_settings","overtime_records","leave_requests","attendance","employee_documents","employee_bank_info","employee_education","employee_experience","employee_emergency_contacts","salary_structures","face_data","biometric_logs","payroll","party_notes","audit_log","login_logs","backup_history","messages","conversation_participants",
        "tds_entries","invoice_payments","invoice_challans","sales_invoice_items_v2","customer_receives","ho_receives","vat_challan_items","purchase_order_items",
        "invoice_status_logs","po_amendments"],
      ["sales_returns"],
      ["sales_invoices_v2","delivery_challans","vat_challans","purchase_orders"],
      ["acc_vouchers","party_payments","sales_invoices","production_entries","bill_of_materials","employees","conversations"],
      ["sections","shifts","biometric_devices","stock_adjustments"],
      ["customers","suppliers","item_master","products","raw_materials"],
      ["item_categories","units","warehouses","product_categories","stock_groups"],
    ];
    for (const grp of resetGroups) {
      for (const t of grp) {
        const { error } = await db.from(t).delete().not("id", "is", null);
        if (error) log.push(`del ${t}: ${error.message}`);
      }
    }
    await db.from("profiles").delete().not("employee_id", "is", null);

    if (MODE === "reset") {
      // Reset-only mode: protect Chart of Accounts, IFRS Mapping, Document Numbering,
      // Page Shortcuts, General Settings, SMS, Branding (untouched above).
      await db.from("audit_log").insert({
        user_id: UID, user_name: user.email,
        action: "demo_reset", module: "backup",
        details: `Demo reset (config preserved) completed in ${Date.now() - t0}ms`,
      });
      return new Response(JSON.stringify({
        success: true,
        mode: "reset",
        message: "All demo transactional + master data wiped. Configuration preserved.",
        elapsedMs: Date.now() - t0,
        log,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }



    // ===== RESOLVE / ENSURE MASTER REFS =====
    // Branches
    const { data: brData } = await db.from("branches").select("id,code,name").order("created_at");
    let branches = brData || [];
    if (branches.length === 0) {
      const ins = [
        { id: U(), code: "HO", name: "Head Office", phone: "+8801700000000", address: "Dhaka", status: "active" },
        { id: U(), code: "FAC", name: "Factory", phone: "+8801800000000", address: "Gazipur", status: "active" },
      ];
      await db.from("branches").insert(ins);
      branches = ins.map(b => ({ id:b.id, code:b.code, name:b.name }));
    } else if (branches.length === 1) {
      const id = U();
      await db.from("branches").insert([{ id, code: "FAC", name: "Factory", phone: "+8801800000000", address: "Gazipur", status: "active" }]);
      branches.push({ id, code: "FAC", name: "Factory" });
    }
    const BR_DHK = branches[0].id, BR_CTG = branches[1].id;

    // Financial Year — match calendar year that covers most recent 1y window
    const today = new Date();
    const fyStart = new Date(today.getFullYear() - 1, today.getMonth(), 1);
    const fyEnd = new Date(today.getFullYear(), today.getMonth(), 0); // last day of prev month
    const fyName = `Demo FY ${fyStart.getFullYear()}-${fyEnd.getFullYear()}`;
    await db.from("financial_years").update({ is_active: false }).neq("id", "00000000-0000-0000-0000-000000000000");
    let { data: fyExist } = await db.from("financial_years").select("id").eq("name", fyName).maybeSingle();
    let FY: string;
    if (fyExist) {
      FY = fyExist.id;
      await db.from("financial_years").update({ start_date: ymd(fyStart), end_date: ymd(fyEnd), is_active: true }).eq("id", FY);
    } else {
      FY = U();
      await db.from("financial_years").insert([{ id: FY, name: fyName, start_date: ymd(fyStart), end_date: ymd(fyEnd), is_active: true }]);
    }
    await db.from("company_settings").update({ default_financial_year_id: FY, default_branch_id: BR_DHK }).eq("id", "default");

    // Departments & Designations
    let { data: depts } = await db.from("departments").select("id,name");
    if (!depts || depts.length === 0) {
      const ins = ["Administration","Production","Sales","Finance"].map(n => ({ id: U(), name: n }));
      await db.from("departments").insert(ins); depts = ins;
    }
    let { data: desigs } = await db.from("designations").select("id,name");
    if (!desigs || desigs.length === 0) {
      const ins = ["Manager","Officer","Worker","Executive"].map(n => ({ id: U(), name: n }));
      await db.from("designations").insert(ins); desigs = ins;
    }
    const DEPT = depts![0].id, DESIG = desigs![0].id;

    // Sections (per department) + Shifts
    const sectionRows = depts!.flatMap((d:any) => [
      { id: U(), name: `${d.name} - Section A`, department_id: d.id, branch_id: BR_DHK, status: "active" },
      { id: U(), name: `${d.name} - Section B`, department_id: d.id, branch_id: BR_DHK, status: "active" },
    ]);
    await db.from("sections").insert(sectionRows);
    const SEC = sectionRows[0].id;

    const shiftRows = [
      { id: U(), shift_name: "Morning",   start_time: "08:00:00", end_time: "16:00:00", late_after_minutes: 10 },
      { id: U(), shift_name: "General",   start_time: "09:00:00", end_time: "18:00:00", late_after_minutes: 15 },
      { id: U(), shift_name: "Evening",   start_time: "14:00:00", end_time: "22:00:00", late_after_minutes: 10 },
      { id: U(), shift_name: "Night",     start_time: "22:00:00", end_time: "06:00:00", late_after_minutes: 15 },
    ];
    await db.from("shifts").insert(shiftRows);
    const SHIFT = shiftRows[1].id;

    // Leave types
    let { data: lts } = await db.from("leave_types").select("id,name");
    if (!lts || lts.length === 0) {
      const ins = [["Annual",14],["Sick",10],["Casual",7]].map(([n,d]) => ({ id: U(), name: n as string, days_per_year: d as number }));
      await db.from("leave_types").insert(ins); lts = ins;
    }

    // Chart of accounts — resolve by code (NOT name)
    const { data: coa } = await db.from("chart_of_accounts").select("id,account_code").eq("is_active", true);
    const A: Record<string,string> = {};
    for (const a of (coa || [])) A[a.account_code] = a.id;
    const need = ["1101","1102","1103","1105","1107","2101","2104","2106","3101","4101","4105","5101","5103","5201","5202","5203","5204","5205","5209","6101","6102"];
    for (const c of need) if (!A[c]) throw new Error(`Missing CoA code ${c}. Re-run Chart of Accounts seed first.`);
    // Friendly aliases
    const Ac = {
      cash:A["1101"], bank:A["1102"], ar:A["1103"], inv:A["1105"], tdsr:A["1107"],
      ap:A["2101"], vatPay:A["2104"], pfLiab:A["2106"],
      cap:A["3101"], sales:A["4101"], salesRet:A["4105"],
      pur:A["5101"], purRet:A["5103"], sal:A["5201"], rent:A["5202"], util:A["5203"], off:A["5204"], tr:A["5205"], pfExp:A["5209"],
      vatIn:A["6101"], vatOut:A["6102"],
    };

    // Bank Accounts — sub-accounts under "Bank Account" (1102) so the Bank Accounts page is populated
    const bankSubs = [
      { code: "1111", name: "EBL Current A/C - 1234567890" },
      { code: "1112", name: "City Bank Current A/C - 9988776655" },
      { code: "1113", name: "BRAC Bank Savings A/C - 4455667788" },
      { code: "1114", name: "HSBC USD A/C - 0011223344" },
    ];
    const existingBankCodes = new Set((coa || []).map((a: any) => a.account_code));
    const bankRowsToInsert = bankSubs
      .filter((b) => !existingBankCodes.has(b.code))
      .map((b) => ({
        id: U(),
        account_code: b.code,
        account_name: b.name,
        account_type: "asset",
        parent_id: Ac.bank,
        opening_balance: 0,
        opening_balance_type: "debit",
        is_active: true,
      }));
    if (bankRowsToInsert.length > 0) {
      const { error: bErr } = await db.from("chart_of_accounts").insert(bankRowsToInsert);
      if (bErr) throw new Error(`bank accounts: ${bErr.message}`);
    }



    const bulk = async (t: string, rows: any[], ch = 800) => {
      if (rows.length === 0) return;
      for (let i = 0; i < rows.length; i += ch) {
        const { error } = await db.from(t).insert(rows.slice(i, i + ch));
        if (error) throw new Error(`${t}: ${error.message}`);
      }
    };

    // Warehouses
    const WH_DHK = U(), WH_CTG = U();
    await bulk("warehouses", [
      { id: WH_DHK, warehouse_code: "WH-HO", warehouse_name: "Head Office Warehouse", branch_id: BR_DHK, status: "active" },
      { id: WH_CTG, warehouse_code: "WH-FAC", warehouse_name: "Factory Warehouse", branch_id: BR_CTG, status: "active" },
    ]);

    // Units
    // Units (plastic manufacturing: PCS for finished, KG for resin, BAG/DRUM for bulk raw, BOX for packaging)
    const ud: [string,string][] = [["PCS","Pieces"],["KG","Kilogram"],["BAG","Bag (25kg)"],["DRUM","Drum (200L)"],["BOX","Carton/Box"],["MTR","Meter"]];
    const uIds: Record<string,string> = {};
    await bulk("units", ud.map(([a,n]) => { const id=U(); uIds[a]=id; return {id,name:n,abbreviation:a}; }));

    // Categories — plastic moulding products
    const cd = ["Bottles","Caps","Plugs","Discs","Raw Materials","Additives","Packaging"];
    const cIds: Record<string,string> = {};
    const catRows = cd.map(n => { const id=U(); cIds[n]=id; return {id,name:n}; });
    await bulk("product_categories", catRows);
    await bulk("item_categories", catRows.map(c => ({ ...c, is_active:true })));

    // Stock Groups (primary inventory classification)
    const sgNames = ["Finished Goods","Raw Materials","Packaging","Additives"];
    const sgIds: Record<string,string> = {};
    const sgRows = sgNames.map(n => { const id=U(); sgIds[n]=id; return { id, name:n, is_default: n==="Finished Goods", is_active:true }; });
    await bulk("stock_groups", sgRows);
    // primary_group_id self-reference (top-level)
    for (const r of sgRows) await db.from("stock_groups").update({ primary_group_id: r.id }).eq("id", r.id);
    const catToGroup = (cat: string) =>
      ["Bottles","Caps","Plugs","Discs"].includes(cat) ? sgIds["Finished Goods"]
      : cat === "Raw Materials" ? sgIds["Raw Materials"]
      : cat === "Additives" ? sgIds["Additives"]
      : sgIds["Packaging"];

    // Products
    // Products — Plastic Bottle / Cap / Plug / Disc manufacturer
    // First 10 = FINISHED GOODS (PCS, used as BOM outputs); rest = RAW MATERIALS / PACKAGING
    const PD: [string,string,string,number,number][] = [
      // ── Finished Goods (10) ──
      ["PET Water Bottle 500ml","Bottles","PCS",4.5,8.5],
      ["PET Water Bottle 1000ml","Bottles","PCS",7.0,13.0],
      ["HDPE Oil Bottle 1L","Bottles","PCS",12.0,20.0],
      ["PET Juice Bottle 250ml","Bottles","PCS",3.2,6.5],
      ["Pharma Bottle Amber 100ml","Bottles","PCS",6.5,11.5],
      ["Bottle Cap 28mm PCO","Caps","PCS",0.85,1.6],
      ["Bottle Cap 38mm Flip-Top","Caps","PCS",1.4,2.8],
      ["Pharma Plug 18mm LDPE","Plugs","PCS",0.55,1.1],
      ["Tamper-Evident Plug 25mm","Plugs","PCS",0.95,1.9],
      ["Plastic Disc 30mm Sealing","Discs","PCS",0.35,0.7],
      // ── Raw Materials (used in BOMs) ──
      ["PET Resin Bottle Grade","Raw Materials","KG",145,0],
      ["HDPE Resin Blow-Mould Grade","Raw Materials","KG",135,0],
      ["PP Resin Cap Grade","Raw Materials","KG",155,0],
      ["LDPE Resin","Raw Materials","KG",148,0],
      ["PET Preform 9.3g","Raw Materials","PCS",2.8,0],
      ["PET Preform 16g","Raw Materials","PCS",4.6,0],
      ["Master-batch Blue","Additives","KG",420,0],
      ["Master-batch White","Additives","KG",380,0],
      ["Master-batch Amber","Additives","KG",450,0],
      ["UV Stabilizer Additive","Additives","KG",680,0],
      ["Anti-Static Additive","Additives","KG",520,0],
      ["Mould Release Agent","Additives","KG",350,0],
      // ── Packaging ──
      ["Carton Box Large","Packaging","BOX",35,0],
      ["Carton Box Medium","Packaging","BOX",24,0],
      ["Shrink Wrap Film","Packaging","KG",240,0],
      ["BOPP Tape 48mm","Packaging","PCS",45,0],
      ["Pallet Wooden 1.2m","Packaging","PCS",650,0],
      ["Stretch Film 17mic","Packaging","KG",220,0],
      ["Label Sticker Roll","Packaging","PCS",380,0],
      ["Strapping Band PP","Packaging","PCS",1850,0],
    ];
    type P = { id:string; iid:string; code:string; name:string; cat:string; unit:string; cp:number; sp:number; op:number };
    const products: P[] = PD.map((p,i) => {
      const uid = U();
      return { id: uid, iid: uid, code: `PRD-${String(i+1).padStart(4,"0")}`,
        name: p[0], cat: p[1], unit: p[2], cp: p[3], sp: p[4], op: RI(50,300) };
    });
    await bulk("products", products.map(p => ({
      id:p.id, product_code:p.code, product_name:p.name, category_id:cIds[p.cat],
      unit:p.unit, cost_price:p.cp, selling_price:p.sp, low_stock_threshold:10, status:"active",
    })));
    await bulk("item_master", products.map(p => ({
      id:p.iid, item_code:p.code, item_name:p.name, item_type:"product", is_stock_item:true,
      opening_stock:p.op, category_id:cIds[p.cat], unit_id:uIds[p.unit], stock_group_id: catToGroup(p.cat),
      cost_price:p.cp, selling_price:p.sp, min_stock_level:10, status:"active",
    })));

    // Customers / Suppliers
    // Customers — buyers of plastic bottles/caps/plugs/discs
    const cn = ["Pran Beverages Ltd","Akij Food & Beverage","Mum Mineral Water","Fresh Drinks BD",
      "Square Pharmaceuticals","Beximco Pharma","Incepta Pharma","Renata Limited",
      "Marico Bangladesh","Unilever BD","Kohinoor Cosmetics","Keya Cosmetics",
      "City Edible Oil","Teer Oil Mills","Rupchanda Foods"];
    const customers = cn.map((n,i) => ({ id:U(), name:n, phone:`+8801${700000000+i*1111}`, email:n.toLowerCase().replace(/[^a-z0-9]/g,"")+"@example.com", address:"Dhaka, Bangladesh", status:"active" }));
    await bulk("customers", customers);
    // Suppliers — resin/additive/packaging suppliers
    const sn = ["IRPC Polymer Ltd","Reliance Industries (PET)","SCG Chemicals BD",
      "LG Chem Bangladesh","Clariant Masterbatch","Ampacet Colorants",
      "BASF Additives BD","Star Packaging Industries"];
    const suppliers = sn.map((n,i) => ({
      id: U(), code: `SUP-${String(i+1).padStart(4,"0")}`, name: n,
      supplier_type: "regular", is_active: true,
      phone: `+8801${600000000+i*2222}`, email: n.toLowerCase().replace(/[^a-z0-9]/g,"")+"@example.com",
      address: "Dhaka, Bangladesh", city: "Dhaka", country: "Bangladesh",
      currency: "BDT", payment_terms: `Net ${pick([0,15,30,45])}`,
    }));
    await bulk("suppliers", suppliers);

    // Employees + salary structures
    const fns = ["Rahim","Karim","Salam","Hasan","Nasir","Jamil","Tarek","Imran","Farhad","Mizan","Fatema","Nasrin","Sumi","Ayesha","Rabeya"];
    const lns = ["Ahmed","Khan","Hossain","Islam","Rahman","Chowdhury","Akter","Begum","Sultana","Hoque","Ahmed","Khan","Hossain","Islam","Rahman"];
    const basicChoices = [18000,22000,28000,35000,45000,55000];
    type E = { id:string; code:string; basic:number; join:string; name:string };
    const fyStartIso = ymd(fyStart);
    const employees: E[] = fns.map((fn,i) => {
      const basic = pick(basicChoices);
      // First 10 joined before FY, rest joined within first 3 months
      const join = i < 10 ? fyStartIso : ymd(new Date(fyStart.getFullYear(), fyStart.getMonth() + RI(1,3), 1));
      return { id: U(), code: `EMP-${1000+i+1}`, basic, join, name: `${fn} ${lns[i]}` };
    });
    await bulk("employees", employees.map((e,i) => ({
      id:e.id, employee_code:e.code, first_name:fns[i], last_name:lns[i],
      mobile:`+8801${900000000+i*333}`, email:fns[i].toLowerCase()+i+"@erp.com",
      department_id:DEPT, designation_id:DESIG, section_id: sectionRows[i % sectionRows.length].id,
      shift_id: shiftRows[i % shiftRows.length].id, branch_id: i<10?BR_DHK:BR_CTG,
      joining_date:e.join, salary:e.basic, employment_type:"permanent", status:"active",
      employee_category:"staff",
      approval_status: i >= 13 ? "pending" : "approved",
      approved_by: i >= 13 ? null : UID,
      approved_at: i >= 13 ? null : new Date().toISOString(),
    })));
    await bulk("salary_structures", employees.map(e => {
      const hr = Math.floor(e.basic*0.4), med = Math.floor(e.basic*0.1), oth = Math.floor(e.basic*0.05);
      return { id:U(), employee_id:e.id, basic_salary:e.basic, house_rent:hr, medical_allowance:med, other_allowance:oth, total_salary:e.basic+hr+med+oth, effective_from:e.join };
    }));
    // Provident fund settings for permanent staff
    await bulk("employee_fund_settings", employees.map(e => ({
      id:U(), employee_id:e.id, fund_type:"provident_fund",
      calculation_type:"percentage", employee_rate:10, employer_rate:10,
      effective_from:e.join, is_active:true,
    })));

    // ===== Voucher generator =====
    const vc = { JV:0, PV:0, RV:0, CV:0 } as Record<string,number>;
    const vouchers: any[] = [];
    const ventries: any[] = [];
    const fyTag = `${String(fyStart.getFullYear()).slice(2)}${String(fyEnd.getFullYear()).slice(2)}`;
    const addV = (vtype: string, vdate: string, desc: string, entries: [string,number,number,string][]) => {
      const vid = U();
      const total = entries.reduce((s,e) => s+e[1], 0);
      const pmap: Record<string,string> = { journal:"JV", payment:"PV", receipt:"RV", contra:"CV" };
      const pfx = pmap[vtype]; vc[pfx]++;
      const vn = `${pfx}-${fyTag}-${String(vc[pfx]).padStart(5,"0")}`;
      vouchers.push({ id:vid, voucher_number:vn, voucher_type:vtype, voucher_date:vdate, description:desc,
        total_amount:round2(total), status:"approved", branch_id:BR_DHK, financial_year_id:FY,
        created_by:UID, approved_by:UID, approved_at:vdate });
      entries.forEach((e,idx) => ventries.push({ id:U(), voucher_id:vid, account_id:e[0], debit:round2(e[1]), credit:round2(e[2]), narration:e[3], sort_order:idx }));
      return vid;
    };

    // Opening
    const invOpen = products.reduce((s,p) => s+p.cp*p.op, 0);
    const cashOp = 200000, bankOp = 800000, apOp = 150000;
    const capital = cashOp+bankOp+invOpen-apOp;
    addV("journal", fyStartIso, "Opening Balance Entry", [
      [Ac.cash,cashOp,0,"Opening cash"], [Ac.bank,bankOp,0,"Opening bank"],
      [Ac.inv,invOpen,0,"Opening inventory"], [Ac.ap,0,apOp,"Opening payables"],
      [Ac.cap,0,capital,"Owner capital"],
    ]);

    // ===== Daily Sales + Purchases (with VAT) =====
    const VAT_RATE = 0.15;
    const start = new Date(fyStart), end = new Date(fyEnd);
    const sinv: any[] = [], sitems: any[] = [], pinv: any[] = [], pitems: any[] = [], smov: any[] = [];
    type SI = { id:string; cid:string; date:string; net:number; vat:number; gross:number; cash:boolean; num:string };
    type PI = { id:string; sid:string; date:string; subtotal:number; vat:number; gross:number; credit:boolean; num:string };
    const sList: SI[] = [], pList: PI[] = [];
    let sc=0, pc=0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
      if (d.getDay() === 5) continue;
      const ds = ymd(d);
      const dayCount = RI(2,4);
      for (let j = 0; j < dayCount; j++) {
        const cust = pick(customers);
        const items = pickN(products.slice(0, 10), RI(1,4)); // Sell only finished goods
        const qtyMin = 100, qtyMax = 2000; // plastic items sold in bulk
        const invId = U();
        let subtotal = 0;
        const rows: [string,number,number,number,string][] = [];
        for (const p of items) {
          const qty = RI(qtyMin, qtyMax), price = p.sp, tot = qty*price;
          subtotal += tot;
          rows.push([p.id,qty,price,tot,p.iid]);
        }
        const disc = round2(subtotal * pick([0,0,0,0.02,0.05]));
        const net = round2(subtotal - disc);
        const vat = round2(net * VAT_RATE);
        const gross = round2(net + vat);
        sc++;
        const inum = `INV-${fyTag}-${String(sc).padStart(5,"0")}`;
        sinv.push({ id:invId, invoice_number:inum, invoice_date:ds, customer_id:cust.id, branch_id: R()<0.85?BR_DHK:BR_CTG,
          total_amount:subtotal, discount:disc, net_amount:gross, status:"approved", created_by:UID });
        for (const r of rows) {
          sitems.push({ id:U(), sales_invoice_id:invId, product_id:r[4], quantity:r[1], price:r[2], discount:0, total:r[3] });
          smov.push({ id:U(), product_id:r[4], item_id:r[4], warehouse_id:WH_DHK, branch_id:BR_DHK,
            movement_type:"sale", reference_type:"sales_invoice", reference_id:invId, quantity:r[1] });
        }
        const cash = R() < 0.35;
        const dr = cash ? Ac.cash : Ac.ar;
        addV(cash ? "receipt" : "journal", ds, `Sales Invoice ${inum}`, [
          [dr, gross, 0, `Sale to ${cust.name}`],
          [Ac.sales, 0, net, `Revenue ${inum}`],
          [Ac.vatOut, 0, vat, `Output VAT ${inum}`],
        ]);
        sList.push({ id:invId, cid:cust.id, date:ds, net, vat, gross, cash, num: inum });
      }
      // Purchase generation removed with Purchase module
    }

    await bulk("sales_invoices", sinv);
    await bulk("sales_invoice_items", sitems);
    await bulk("stock_movements", smov);

    // ===== Sales Returns (random 3% of invoices) =====
    const sret: any[] = [], sretItems: any[] = [];
    let src = 0;
    for (const s of sList) {
      if (R() > 0.03) continue;
      const items = sitems.filter(x => x.sales_invoice_id === s.id);
      if (!items.length) continue;
      const rid = U(); src++;
      const rnum = `SRN-${fyTag}-${String(src).padStart(5,"0")}`;
      const retDate = ymd(new Date(new Date(s.date).getTime() + RI(3,15)*86400000));
      if (new Date(retDate) > end) continue;
      let retTotal = 0;
      for (const it of items) {
        const rqty = Math.max(1, Math.floor(it.quantity * 0.3));
        const tot = round2(rqty * it.price);
        retTotal += tot;
        sretItems.push({ id:U(), sales_return_id:rid, product_id:it.product_id, quantity:rqty, price:it.price, total:tot });
      }
      sret.push({ id:rid, return_number:rnum, return_date:retDate, sales_invoice_id:s.id, customer_id:s.cid, branch_id:BR_DHK, total_amount:retTotal, reason:"Customer return", status:"approved", created_by:UID });
      addV("journal", retDate, `Sales Return ${rnum}`, [
        [Ac.salesRet, retTotal, 0, "Sales return"],
        [Ac.ar, 0, retTotal, "AR reduction"],
      ]);
    }
    await bulk("sales_returns", sret);
    await bulk("sales_return_items", sretItems);

    // ===== Purchase configuration (Types, Settings, Approval Matrix, CoA Mapping) =====
    const PT_LOCAL = U(), PT_IMPORT = U(), PT_SERVICE = U(), PT_ASSET = U();
    await db.from("purchase_types").delete().not("id","is",null);
    await bulk("purchase_types", [
      { id: PT_LOCAL,   code: "LOCAL",   name: "Local Purchase",  description: "Domestic supplier purchases", is_system: true, is_active: true, requires_grn: true,  requires_lc: false, affects_inventory: true,  affects_asset: false },
      { id: PT_IMPORT,  code: "IMPORT",  name: "Import (LC)",     description: "Imported goods via LC",       is_system: true, is_active: true, requires_grn: true,  requires_lc: true,  affects_inventory: true,  affects_asset: false },
      { id: PT_SERVICE, code: "SERVICE", name: "Service",         description: "Non-stock service purchase",  is_system: true, is_active: true, requires_grn: false, requires_lc: false, affects_inventory: false, affects_asset: false },
      { id: PT_ASSET,   code: "ASSET",   name: "Capital / Asset", description: "Fixed asset acquisition",     is_system: true, is_active: true, requires_grn: true,  requires_lc: false, affects_inventory: false, affects_asset: true  },
    ]);
    await db.from("purchase_settings").delete().not("id","is",null);
    await db.from("purchase_settings").insert({
      id: U(), enforce_grn_for_bill: true, allow_over_receive: false, allow_over_bill: false,
      default_currency: "BDT", default_vat_percent: 15, default_ait_percent: 0,
      pr_prefix: "PR", po_prefix: "PO2", grn_prefix: "GRN", bill_prefix: "SB", pay_prefix: "SP", lc_prefix: "LC",
      auto_post_grn: true, auto_post_bill: true, auto_post_payment: true,
      enable_multi_currency: false, enable_landed_cost: false, enable_lc_module: true,
    });
    await db.from("purchase_coa_mapping").delete().not("id","is",null);
    await bulk("purchase_coa_mapping", [PT_LOCAL, PT_IMPORT, PT_SERVICE, PT_ASSET].map(ptid => ({
      id: U(), purchase_type_id: ptid, branch_id: BR_DHK,
      inventory_account_id: Ac.inv, payable_account_id: Ac.ap,
      vat_input_account_id: Ac.vatIn, cash_account_id: Ac.cash, bank_account_id: Ac.bank,
      expense_account_id: Ac.pur, discount_account_id: Ac.pur, freight_account_id: Ac.pur,
      is_active: true,
    })));
    await db.from("purchase_approval_matrix").delete().not("id","is",null);
    await bulk("purchase_approval_matrix", [
      { id: U(), document_type: "PR", purchase_type_id: PT_LOCAL,  branch_id: BR_DHK, min_amount: 0,      max_amount: 50000,     step_order: 1, approver_role: "manager",  is_active: true },
      { id: U(), document_type: "PR", purchase_type_id: PT_LOCAL,  branch_id: BR_DHK, min_amount: 50000,  max_amount: 999999999, step_order: 1, approver_role: "director", is_active: true },
      { id: U(), document_type: "PO", purchase_type_id: PT_LOCAL,  branch_id: BR_DHK, min_amount: 0,      max_amount: 100000,    step_order: 1, approver_role: "manager",  is_active: true },
      { id: U(), document_type: "PO", purchase_type_id: PT_LOCAL,  branch_id: BR_DHK, min_amount: 100000, max_amount: 999999999, step_order: 1, approver_role: "director", is_active: true },
      { id: U(), document_type: "PO", purchase_type_id: PT_IMPORT, branch_id: BR_DHK, min_amount: 0,      max_amount: 999999999, step_order: 1, approver_role: "director", is_active: true },
      { id: U(), document_type: "BILL", purchase_type_id: PT_LOCAL, branch_id: BR_DHK, min_amount: 0,     max_amount: 999999999, step_order: 1, approver_role: "manager",  is_active: true },
    ]);

    // ===== Purchase Orders v2 + GRNs + Supplier Bills + Payments + PRs + Returns + LC =====
    const POs2: any[] = [], POitems2: any[] = [];
    const GRNs: any[] = [], GRNitems: any[] = [];
    const SBills: any[] = [], SBitems: any[] = [];
    const SPays: any[] = [], SPallocs: any[] = [];
    const PRs: any[] = [], PRitems: any[] = [], PRPOlinks: any[] = [];
    const PRets: any[] = [], PRetItems: any[] = [];
    const LCs: any[] = [], LCcharges: any[] = [];
    let poc2 = 0, grnc = 0, sbc = 0, spc = 0, prc = 0, prq = 0, lcc = 0;
    // Weekly cadence — one PO per business week per rotating supplier
    for (let d = new Date(start), wk = 0; d <= end; d.setDate(d.getDate() + 7), wk++) {
      const sup = suppliers[wk % suppliers.length];
      const ds = ymd(d);
      const items = pickN(products.slice(10), RI(2, 5)); // Purchase only raw materials & packaging
      let subtotal = 0;
      const lines: { itemId: string; itemName: string; qty: number; price: number; total: number }[] = [];
      for (const p of items) {
        const qty = RI(50, 500), price = p.cp; // bulk raw material purchases
        const total = qty * price;
        subtotal += total;
        lines.push({ itemId: p.iid, itemName: p.name, qty, price, total });
      }
      const vat = round2(subtotal * VAT_RATE);
      const grand = round2(subtotal + vat);
      const isImport = (wk % 8 === 0); // ~1 in 8 POs is an Import/LC
      const ptId = isImport ? PT_IMPORT : PT_LOCAL;
      // PR (created 5 days before PO)
      prq++;
      const prId = U();
      const prNum = `PR-${fyTag}-${String(prq).padStart(5, "0")}`;
      const prDate = ymd(new Date(d.getTime() - 5 * 86400000));
      PRs.push({
        id: prId, pr_no: prNum, pr_date: prDate, required_date: ds,
        purchase_type_id: ptId, branch_id: BR_DHK, warehouse_id: WH_DHK,
        requested_by: UID, requested_by_name: "Demo Requester",
        priority: pick(["normal","normal","high"]), status: "Closed",
        total_estimated: subtotal, remarks: "Auto-generated demo PR",
        created_by: UID,
      });
      const prItemIds: string[] = [];
      lines.forEach((l, i) => {
        const prItemId = U(); prItemIds.push(prItemId);
        PRitems.push({
          id: prItemId, pr_id: prId, line_no: i + 1, item_id: l.itemId,
          item_description: l.itemName, quantity: l.qty,
          estimated_price: l.price, estimated_amount: l.total,
          ordered_qty: l.qty, status: "Closed",
        });
      });
      // PO
      poc2++;
      const poId = U();
      const poNum = `PO2-${fyTag}-${String(poc2).padStart(5, "0")}`;
      POs2.push({
        id: poId, po_no: poNum, po_date: ds, supplier_id: sup.id, purchase_type_id: ptId,
        branch_id: BR_DHK, warehouse_id: WH_DHK, exchange_rate: 1,
        subtotal, discount_amount: 0, freight_amount: 0, vat_amount: vat,
        ait_amount: 0, other_charges: 0, grand_total: grand, received_total: grand,
        status: "Approved", revision_no: 0, created_by: UID, currency: "BDT",
      });
      const poItemIds: string[] = [];
      lines.forEach((l, i) => {
        const poItemId = U(); poItemIds.push(poItemId);
        POitems2.push({
          id: poItemId, po_id: poId, line_no: i + 1, item_id: l.itemId,
          item_description: l.itemName, quantity: l.qty, unit_price: l.price,
          discount_percent: 0, vat_percent: 15, ait_percent: 0,
          line_total: l.total, received_qty: l.qty, billed_qty: l.qty,
        });
        PRPOlinks.push({ id: U(), po_item_id: poItemId, pr_item_id: prItemIds[i], linked_qty: l.qty });
      });
      // GRN (received 3 days after PO)
      const grnDate = ymd(new Date(d.getTime() + 3 * 86400000));
      if (new Date(grnDate) > end) continue;
      grnc++;
      const grnId = U();
      const grnNum = `GRN-${fyTag}-${String(grnc).padStart(5, "0")}`;
      GRNs.push({
        id: grnId, grn_no: grnNum, grn_date: grnDate, po_id: poId,
        supplier_id: sup.id, branch_id: BR_DHK, warehouse_id: WH_DHK,
        subtotal, freight_amount: 0, other_charges: 0, grand_total: grand,
        status: "Approved", auto_post: true, created_by: UID,
        approved_by: UID, approved_at: grnDate,
      });
      const grnItemIds: string[] = [];
      lines.forEach((l, i) => {
        const gid = U(); grnItemIds.push(gid);
        GRNitems.push({
          id: gid, grn_id: grnId, line_no: i + 1, item_id: l.itemId,
          item_description: l.itemName, ordered_qty: l.qty,
          received_qty: l.qty, accepted_qty: l.qty, rejected_qty: 0,
          unit_cost: l.price, line_value: l.total,
        });
      });
      // GRN posting: Dr Inventory + VAT Input, Cr AP
      addV("journal", grnDate, `GRN ${grnNum} (${sup.name})`, [
        [Ac.inv, subtotal, 0, `Inventory in (${sup.name})`],
        [Ac.vatIn, vat, 0, `Input VAT ${grnNum}`],
        [Ac.ap, 0, grand, `Payable to ${sup.name}`],
      ]);
      // Purchase Return (~8% of GRNs — first line, partial qty)
      if (R() < 0.08 && lines.length > 0) {
        const retDate = ymd(new Date(new Date(grnDate).getTime() + RI(2, 10) * 86400000));
        if (new Date(retDate) <= end) {
          prc++;
          const retId = U();
          const retNum = `PRET-${fyTag}-${String(prc).padStart(5, "0")}`;
          const rl = lines[0];
          const rqty = Math.max(1, Math.floor(rl.qty * 0.1));
          const rSub = round2(rqty * rl.price);
          const rVat = round2(rSub * VAT_RATE);
          const rGrand = round2(rSub + rVat);
          PRets.push({
            id: retId, return_no: retNum, return_date: retDate,
            supplier_id: sup.id, grn_id: grnId, branch_id: BR_DHK, warehouse_id: WH_DHK,
            reason: pick(["Damaged in transit","Quality issue","Wrong specification"]),
            subtotal: rSub, vat_amount: rVat, grand_total: rGrand,
            status: "Approved", created_by: UID,
          });
          PRetItems.push({
            id: U(), return_id: retId, item_id: rl.itemId, grn_item_id: grnItemIds[0],
            description: rl.itemName, quantity: rqty, unit_cost: rl.price,
            vat_rate: 15, line_total: rGrand, sort_order: 1,
          });
          addV("journal", retDate, `Purchase Return ${retNum}`, [
            [Ac.ap, rGrand, 0, `AP reversal ${retNum}`],
            [Ac.inv, 0, rSub, "Inventory reversal"],
            [Ac.vatIn, 0, rVat, "Input VAT reversal"],
          ]);
        }
      }
      // LC document for IMPORT POs
      if (isImport) {
        lcc++;
        const lcId = U();
        const lcNum = `LC-${fyTag}-${String(lcc).padStart(5, "0")}`;
        const lcDate = ymd(new Date(d.getTime() - 15 * 86400000));
        const expDate = ymd(new Date(d.getTime() + 90 * 86400000));
        const charges = round2(grand * 0.04);
        LCs.push({
          id: lcId, lc_no: lcNum, lc_date: lcDate, expiry_date: expDate,
          supplier_id: sup.id, branch_id: BR_DHK, bank_name: pick(["EBL","HSBC BD","BRAC Bank","City Bank"]),
          lc_type: pick(["Sight","Usance"]), currency: "USD", exchange_rate: 110,
          lc_amount: round2(grand / 110), margin_pct: 10, margin_amount: round2(grand * 0.10),
          total_charges: charges, landed_cost: round2(grand + charges),
          po_id: poId, grn_id: grnId, status: "Closed",
          notes: "Demo LC", created_by: UID,
        });
        LCcharges.push(
          { id: U(), lc_id: lcId, charge_type: "Bank Charge", charge_date: lcDate, description: "LC opening commission", amount: round2(charges * 0.4), currency: "BDT", account_id: Ac.bank, reference_no: lcNum },
          { id: U(), lc_id: lcId, charge_type: "Freight",      charge_date: grnDate, description: "Sea freight",            amount: round2(charges * 0.5), currency: "BDT", account_id: Ac.bank, reference_no: lcNum },
          { id: U(), lc_id: lcId, charge_type: "Duty",         charge_date: grnDate, description: "Customs duty",           amount: round2(charges * 0.1), currency: "BDT", account_id: Ac.bank, reference_no: lcNum },
        );
      }
      // Supplier Bill (5 days after GRN)
      const billDate = ymd(new Date(new Date(grnDate).getTime() + 5 * 86400000));
      if (new Date(billDate) > end) continue;
      sbc++;
      const billId = U();
      const billNum = `SB-${fyTag}-${String(sbc).padStart(5, "0")}`;
      SBills.push({
        id: billId, bill_no: billNum, bill_date: billDate, status: "Approved",
        supplier_id: sup.id, po_id: poId, grn_id: grnId,
        subtotal, vat_amount: vat, grand_total: grand,
        branch_id: BR_DHK, created_by: UID,
      });
      SBitems.push({ id: U(), bill_id: billId, description: "Per GRN " + grnNum, quantity: 1, unit_price: subtotal, line_total: subtotal });
      // Supplier Payment (15-30 days after bill, 70% of bills)
      if (R() < 0.7) {
        const payDate = ymd(new Date(new Date(billDate).getTime() + RI(15, 30) * 86400000));
        if (new Date(payDate) > end) continue;
        spc++;
        const payId = U();
        const payNum = `SP-${fyTag}-${String(spc).padStart(5, "0")}`;
        const mode = pick(["bank", "cash", "cheque"]);
        const credAc = mode === "cash" ? Ac.cash : Ac.bank;
        SPays.push({
          id: payId, payment_no: payNum, payment_date: payDate, amount: grand,
          status: "Approved", supplier_id: sup.id, payment_method: mode,
          branch_id: BR_DHK, created_by: UID,
        });
        SPallocs.push({ id: U(), payment_id: payId, bill_id: billId, allocated_amount: grand });
        addV("payment", payDate, `Supplier Payment ${payNum} (${sup.name})`, [
          [Ac.ap, grand, 0, `Settle ${billNum}`],
          [credAc, 0, grand, `Paid to ${sup.name}`],
        ]);
      }
      pc++;
    }
    await bulk("purchase_requisitions", PRs);
    await bulk("purchase_requisition_items", PRitems);
    await bulk("purchase_orders_v2", POs2);
    await bulk("purchase_order_items_v2", POitems2);
    await bulk("po_pr_links", PRPOlinks);
    await bulk("grns_v2", GRNs);
    await bulk("grn_items_v2", GRNitems);
    await bulk("supplier_bills_v2", SBills);
    await bulk("supplier_bill_items_v2", SBitems);
    await bulk("supplier_payments_v2", SPays);
    await bulk("supplier_payment_allocations", SPallocs);
    await bulk("purchase_returns_v2", PRets);
    await bulk("purchase_return_items_v2", PRetItems);
    await bulk("lc_documents", LCs);
    await bulk("lc_charges", LCcharges);


    // ===== Customer Payments (with optional TDS 5%) =====
    const pays: any[] = [], allocs: any[] = [];
    let pmc = 0;
    for (const s of sList) {
      if (s.cash) continue;
      if (R() < 0.78) {
        const pd = new Date(new Date(s.date).getTime() + RI(7,45)*86400000);
        if (pd > end) continue;
        const fullPay = R() < 0.85;
        const settled = fullPay ? s.gross : round2(s.gross * 0.5);
        const tds = fullPay && R() < 0.4 ? round2(s.net * 0.05) : 0;
        const amt = round2(settled - tds);
        const pid = U(); pmc++;
        const ref = `RCP-${fyTag}-${String(pmc).padStart(5,"0")}`;
        const method = pick(["cash","bank","mobile_banking"]);
        pays.push({ id:pid, party_id:s.cid, party_type:"customer", payment_date:ymd(pd),
          amount:settled, payment_method:method, reference:ref, created_by:UID });
        allocs.push({ id:U(), payment_id:pid, invoice_type:"sales_invoice", invoice_id:s.id, allocated_amount:settled });
        const cashDr = method === "cash" ? Ac.cash : Ac.bank;
        const entries: [string,number,number,string][] = [[cashDr, amt, 0, "Customer payment"]];
        if (tds > 0) entries.push([Ac.tdsr, tds, 0, "TDS deducted by customer"]);
        entries.push([Ac.ar, 0, settled, `AR settle ${s.num}`]);
        addV("receipt", ymd(pd), `Receipt ${ref}`, entries);
      }
    }
    // Supplier payments removed with Purchase module
    await bulk("party_payments", pays);
    await bulk("payment_allocations", allocs);

    // ===== Monthly: Expenses, Contra (Cash↔Bank), Payroll, Fund Transactions =====
    const months: Date[] = [];
    for (let m = new Date(fyStart); m <= end; m = new Date(m.getFullYear(), m.getMonth()+1, 1)) months.push(m);

    for (const m of months) {
      const ed = ymd(new Date(m.getFullYear(), m.getMonth(), RI(3,7)));
      const rent=45000, util=RI(8000,15000), off=RI(5000,12000), tr=RI(4000,10000);
      addV("payment", ed, "Monthly Rent", [[Ac.rent,rent,0,"Office rent"],[Ac.cash,0,rent,"Rent paid"]]);
      addV("payment", ed, "Utility Bills", [[Ac.util,util,0,"Electricity/Internet"],[Ac.cash,0,util,"Utility paid"]]);
      addV("payment", ed, "Office Expenses", [[Ac.off,off,0,"Office supplies"],[Ac.cash,0,off,"Office paid"]]);
      addV("payment", ed, "Transportation", [[Ac.tr,tr,0,"Transport"],[Ac.cash,0,tr,"Transport paid"]]);
      // Contra: cash deposit to bank
      const dep = RI(50000, 150000);
      addV("contra", ed, "Cash Deposit to Bank", [[Ac.bank,dep,0,"Bank deposit"],[Ac.cash,0,dep,"Cash withdraw"]]);
    }

    // Payroll + Fund Transactions
    const payroll: any[] = [];
    const fundTx: any[] = [];
    for (const m of months) {
      const eom = new Date(m.getFullYear(), m.getMonth()+1, 0);
      const pd = ymd(eom);
      let netTot = 0, pfEmployerTot = 0, pfEmployeeTot = 0;
      const monthPayroll: { eid: string; basic: number; pfEmp: number }[] = [];
      for (const e of employees) {
        if (new Date(e.join) > m) continue;
        const hr=Math.floor(e.basic*0.4), med=Math.floor(e.basic*0.1), oth=Math.floor(e.basic*0.05);
        const pfEmployee = Math.floor(e.basic * 0.1);
        const pfEmployer = Math.floor(e.basic * 0.1);
        const ded = pfEmployee + pick([0,0,500]);
        const gross = e.basic + hr + med + oth;
        const net = gross - ded;
        netTot += net; pfEmployeeTot += pfEmployee; pfEmployerTot += pfEmployer;
        const pid = U();
        payroll.push({ id:pid, employee_id:e.id, month:m.getMonth()+1, year:m.getFullYear(),
          basic_salary:e.basic, allowances:hr+med+oth, deductions:ded, net_salary:net, status:"paid" });
        monthPayroll.push({ eid: e.id, basic: e.basic, pfEmp: pfEmployee });
      }
      const grossPayroll = netTot + pfEmployeeTot;
      // Voucher: Dr Salary Expense (gross) + PF Expense (employer)
      //          Cr PF Liability (employee+employer), Cr Bank (net)
      const vid = addV("payment", pd, `Payroll ${m.toLocaleString("en",{month:"short",year:"numeric"})}`, [
        [Ac.sal, grossPayroll, 0, `Gross salary ${m.toLocaleString("en",{month:"long",year:"numeric"})}`],
        [Ac.pfExp, pfEmployerTot, 0, "PF employer contribution"],
        [Ac.pfLiab, 0, pfEmployeeTot + pfEmployerTot, "PF liability"],
        [Ac.bank, 0, netTot, "Salary disbursed via bank"],
      ]);
      // fund_transactions per employee
      for (const r of monthPayroll) {
        fundTx.push({
          id:U(), employee_id:r.eid, fund_type:"provident_fund", transaction_type:"contribution",
          employee_amount:r.pfEmp, employer_amount:r.pfEmp, total_amount:r.pfEmp*2,
          month: m.getMonth()+1, year: m.getFullYear(), voucher_id: vid, created_by:UID,
          notes: "Monthly PF contribution",
        });
      }
    }
    await bulk("payroll", payroll);
    await bulk("fund_transactions", fundTx);

    // ===== Vouchers & entries (initial flush; sales-workflow adds more below and flushes again) =====
    const vouchersFlushedTo = vouchers.length;
    const ventriesFlushedTo = ventries.length;
    await bulk("acc_vouchers", vouchers.slice(0, vouchersFlushedTo), 400);
    await bulk("voucher_entries", ventries.slice(0, ventriesFlushedTo), 600);

    // ===== Attendance =====
    const att: any[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
      if (d.getDay() === 5) continue;
      const ds = ymd(d);
      for (const e of employees) {
        if (new Date(e.join) > d) continue;
        const r = R();
        let st = "present", ci: string|null = "09:00:00", co: string|null = "18:00:00";
        if (r < 0.92) {} else if (r < 0.96) { st = "late"; ci = `09:${String(RI(15,55)).padStart(2,"0")}:00`; }
        else if (r < 0.98) { st = "absent"; ci = null; co = null; }
        else { st = "leave"; ci = null; co = null; }
        att.push({ id:U(), employee_id:e.id, date:ds, check_in:ci, check_out:co, status:st });
      }
    }
    await bulk("attendance", att, 800);

    // ===== Leave Requests =====
    const leaves: any[] = [];
    for (const e of employees) {
      const n = RI(1,3);
      for (let i = 0; i < n; i++) {
        const offsetDays = RI(15, 330);
        const s = new Date(fyStart.getTime() + offsetDays * 86400000);
        if (s > end) continue;
        const dur = RI(1, 3);
        const en = new Date(s.getTime() + (dur-1)*86400000);
        leaves.push({
          id:U(), employee_id:e.id, leave_type_id: pick(lts!).id,
          start_date: ymd(s), end_date: ymd(en > end ? end : en),
          reason: pick(["Personal","Family event","Medical","Travel"]),
          status: pick(["approved","approved","approved","pending"]),
          approved_by: UID,
        });
      }
    }
    await bulk("leave_requests", leaves);

    // ===== Overtime Records =====
    const overtime: any[] = [];
    for (const e of employees) {
      const n = RI(2, 5);
      for (let i = 0; i < n; i++) {
        const offsetDays = RI(15, 330);
        const d = new Date(fyStart.getTime() + offsetDays * 86400000);
        if (d > end) continue;
        overtime.push({
          id: U(), employee_id: e.id, date: ymd(d),
          hours: pick([1, 1.5, 2, 2.5, 3, 4]),
          status: pick(["approved","approved","pending"]),
          approved_by: UID,
        });
      }
    }
    await bulk("overtime_records", overtime);

    // ===== Biometric Devices + Logs =====
    const bioDevices = [
      { id: U(), device_name: "ZKTeco F18 - Main Gate", ip_address: "192.168.1.201", port: 4370, location: "Head Office Entrance", status: "online", last_sync_at: new Date().toISOString() },
      { id: U(), device_name: "ZKTeco K40 - Factory",   ip_address: "192.168.1.202", port: 4370, location: "Factory Floor",        status: "online", last_sync_at: new Date().toISOString() },
    ];
    await bulk("biometric_devices", bioDevices);
    const bioLogs: any[] = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(end.getTime() - i * 86400000);
      if (d < start) break;
      for (const e of employees.slice(0, 10)) {
        bioLogs.push({
          id: U(), device_id: bioDevices[0].id, device_name: bioDevices[0].device_name,
          employee_code: e.code, date: ymd(d),
          check_in_time: `09:${String(RI(0,30)).padStart(2,"0")}:00`,
          check_out_time: `18:${String(RI(0,45)).padStart(2,"0")}:00`,
          processed: true,
        });
      }
    }
    await bulk("biometric_logs", bioLogs);

    // ===== Face Data =====
    await bulk("face_data", employees.slice(0, 10).map(e => ({
      id: U(), employee_id: e.id,
      face_encoding: Array.from({length: 16}, () => Math.random().toFixed(4)).join(","),
      photo_url: null,
    })));

    // ===== Employee Documents =====
    const docTypes: [string,string][] = [
      ["appointment_letter", "Appointment Letter"],
      ["nda", "Non-Disclosure Agreement"],
      ["salary_certificate", "Salary Certificate"],
      ["experience_letter", "Experience Letter"],
    ];
    const empDocs: any[] = [];
    for (const e of employees) {
      const picks = pickN(docTypes, RI(1, 3));
      for (const [dt, dtitle] of picks) {
        empDocs.push({
          id: U(), employee_id: e.id, document_type: dt,
          document_title: `${dtitle} - ${e.name}`,
          document_html: `<h2>${dtitle}</h2><p>This document certifies ${e.name} (${e.code}).</p>`,
          generated_by: UID,
        });
      }
    }
    await bulk("employee_documents", empDocs);

    // ===== Stock Transfers (monthly between warehouses) =====
    const transfers: any[] = [];
    let tc = 0;
    for (const m of months) {
      const cnt = RI(1,3);
      for (let i = 0; i < cnt; i++) {
        const td = ymd(new Date(m.getFullYear(), m.getMonth(), RI(8,25)));
        const p = pick(products);
        tc++;
        transfers.push({
          id:U(), transfer_number: `STR-${fyTag}-${String(tc).padStart(5,"0")}`,
          transfer_date: td, from_warehouse_id: WH_DHK, to_warehouse_id: WH_CTG,
          item_id: p.iid, quantity: RI(5,30), status: "completed",
          notes: "Branch replenishment", created_by: UID,
        });
      }
    }
    await bulk("stock_transfers", transfers);

    // ===== Stock Adjustments =====
    const adjustments: any[] = [];
    let adjc = 0;
    for (const m of months) {
      const n = RI(1, 3);
      for (let i = 0; i < n; i++) {
        const p = pick(products);
        adjc++;
        const isIncrease = R() < 0.5;
        const qty = RI(5, 30);
        adjustments.push({
          id: U(), adjustment_number: `ADJ-${fyTag}-${String(adjc).padStart(5,"0")}`,
          adjustment_date: ymd(new Date(m.getFullYear(), m.getMonth(), RI(5, 25))),
          adjustment_type: isIncrease ? "increase" : "decrease",
          product_id: p.id, warehouse_id: WH_DHK, branch_id: BR_DHK,
          quantity: qty, unit_cost: p.cp, total_value: round2(qty * p.cp),
          reason: pick(["Physical count variance","Damaged stock","Stock-take adjustment","Found stock"]),
          notes: "Demo adjustment", created_by: UID,
        });
      }
    }
    await bulk("stock_adjustments", adjustments);

    // ===== Stock Ledger (opening balance per item per warehouse) =====
    const ledger: any[] = [];
    const ledgerDate = ymd(fyStart);
    for (const p of products) {
      // Split opening between two warehouses (70/30)
      const qDhk = Math.floor(p.op * 0.7), qCtg = p.op - qDhk;
      if (qDhk > 0) ledger.push({
        id: U(), transaction_type: "opening", item_id: p.iid,
        branch_id: BR_DHK, warehouse_id: WH_DHK,
        quantity_in: qDhk, quantity_out: 0, balance_quantity: qDhk,
        unit_cost: p.cp, total_value: round2(qDhk * p.cp),
        reference_number: "OPENING", transaction_date: ledgerDate,
      });
      if (qCtg > 0) ledger.push({
        id: U(), transaction_type: "opening", item_id: p.iid,
        branch_id: BR_CTG, warehouse_id: WH_CTG,
        quantity_in: qCtg, quantity_out: 0, balance_quantity: qCtg,
        unit_cost: p.cp, total_value: round2(qCtg * p.cp),
        reference_number: "OPENING", transaction_date: ledgerDate,
      });
    }
    await bulk("stock_ledger", ledger);

    // ===== Bill of Materials + Production =====
    const finished = products.slice(0, 10); // All 10 finished goods get BOMs
    const rawPool = products.slice(10);
    const boms: any[] = [], bomItemsRows: any[] = [];
    for (let i = 0; i < finished.length; i++) {
      const fp = finished[i];
      const bid = U();
      const rms = pickN(rawPool, 3);
      const bomCost = rms.reduce((s,r) => s + r.cp * 2, 0);
      boms.push({
        id:bid, bom_number: `BOM-${String(i+1).padStart(4,"0")}`,
        name: `${fp.name} BOM`, product_id: fp.id,
        current_rate: bomCost, previous_rate: 0,
      });
      for (const r of rms) {
        bomItemsRows.push({
          id:U(), bom_id:bid, material_id:r.id, quantity:2, unit:r.unit,
          wastage_pct:5, unit_price:r.cp,
        });
      }
    }
    await bulk("bill_of_materials", boms);
    await bulk("bom_items", bomItemsRows);

    // Monthly production entries
    const prodEntries: any[] = [], prodMats: any[] = [];
    let prdc = 0;
    for (const m of months) {
      for (const b of boms) {
        if (R() > 0.6) continue;
        const pd = ymd(new Date(m.getFullYear(), m.getMonth(), RI(10,20)));
        const qty = RI(5,20);
        const rmCost = round2(b.current_rate * qty);
        const labor = round2(qty * 200);
        const elec = round2(qty * 50);
        const total = round2(rmCost + labor + elec);
        const pid = U(); prdc++;
        prodEntries.push({
          id:pid, production_number: `PRD-${fyTag}-${String(prdc).padStart(5,"0")}`,
          production_date: pd, product_id: b.product_id, bom_id: b.id, quantity: qty,
          branch_id: BR_DHK, raw_material_cost: rmCost, labor_cost: labor, electricity_cost: elec,
          total_cost: total, status: "completed", created_by: UID,
        });
        const bMats = bomItemsRows.filter(x => x.bom_id === b.id);
        for (const bm of bMats) {
          prodMats.push({ id:U(), production_id:pid, material_id:bm.material_id, quantity: bm.quantity * qty, cost: bm.unit_price * bm.quantity * qty });
        }
      }
    }
    await bulk("production_entries", prodEntries);
    await bulk("production_materials", prodMats);

    // ===== Sales (BD VAT): PO → VAT Challan → DC → Receive → Invoice v2 → Payment + TDS =====
    const POs: any[] = [], POitems: any[] = [];
    const VCHs: any[] = [], VCHitems: any[] = [];
    const DCs: any[] = [], CRs: any[] = [], HRs: any[] = [];
    const INV2: any[] = [], INV2items: any[] = [], INVCHs: any[] = [];
    const IPAYs: any[] = [], TDSs: any[] = [];
    let poc=0, vchc=0, dcc=0, inv2c=0, ipayc=0, tdsc=0;

    const vehicles = ["DHK-METRO-1234","DHK-METRO-5678","CTG-METRO-9012","DHK-METRO-3456","CTG-METRO-7890"];
    const drivers  = ["Karim Mia","Rahim Uddin","Salam Hossain","Jamal Khan","Nasir Ahmed"];

    let _swIdx = 0;
    for (let d = new Date(fyStart); d <= end; d.setDate(d.getDate()+7)) {
      const BR = (_swIdx++ % 2 === 0) ? BR_DHK : BR_CTG;
      const cust = pick(customers);
      const its  = pickN(products.slice(0, 10), RI(2,4)); // Sell finished goods only
      const poDate = ymd(d);
      const delDate = ymd(new Date(d.getTime() + RI(2,7)*86400000));
      const poId = U(); poc++;
      const poNum = `PO-${fyTag}-${String(poc).padStart(5,"0")}`;
      let poSub = 0, poVat = 0;
      const poiData: any[] = [];
      its.forEach((p,idx) => {
        const qty = RI(20,80), rate = p.sp, sub = qty*rate, vat = round2(sub*VAT_RATE);
        poSub += sub; poVat += vat;
        poiData.push({ id:U(), po_id:poId, product_id:p.id, qty_ordered:qty, qty_delivered:qty, qty_remaining:0,
          rate, vat_pct:15, line_subtotal:sub, line_vat:vat, line_total:sub+vat, sort_order:idx });
      });
      const poGrand = round2(poSub + poVat);
      POs.push({ id:poId, po_number:poNum, po_date:poDate, customer_id:cust.id, delivery_date:delDate,
        status:"closed", subtotal:round2(poSub), vat_amount:round2(poVat), grand_total:poGrand,
        notes:"Demo PO", branch_id:BR, financial_year_id:FY, created_by:UID });
      POitems.push(...poiData);

      // Stage controls the terminal workflow state so every queue page has visible demo data.
      // 0: Customer Receive queue (DC=delivered)
      // 1: HO Receive queue       (DC=sent_to_ho, CR done)
      // 2: Invoice Queue          (DC=ho_received, CR+HR done, VAT challan still 'issued')
      // 3: Fully invoiced + paid  (full flow, payment + TDS)
      // 4: Invoiced unpaid/partial(invoice created, no/partial payment)
      const stage = (_swIdx - 1) % 5;
      const dcStatus = stage === 0 ? "delivered"
                     : stage === 1 ? "sent_to_ho"
                     : stage === 2 ? "ho_received"
                     : "invoiced";
      const vchStatus = stage >= 3 ? "invoiced" : "issued";

      // VAT Challan
      const vchId = U(); vchc++;
      const vchNum = `VCH-${fyTag}-${String(vchc).padStart(5,"0")}`;
      const vchDate = ymd(new Date(new Date(poDate).getTime() + RI(1,3)*86400000));
      VCHs.push({ id:vchId, challan_number:vchNum, challan_date:vchDate, customer_id:cust.id, purchase_order_id:poId,
        vehicle_no:pick(vehicles), driver_name:pick(drivers), subtotal:round2(poSub), vat_amount:round2(poVat),
        grand_total:poGrand, source:"purchase_order", status:vchStatus,
        branch_id:BR, financial_year_id:FY, created_by:UID });
      const vciByProduct: Record<string,string> = {};
      poiData.forEach((r,idx) => {
        const vciId = U();
        vciByProduct[r.product_id] = vciId;
        VCHitems.push({ id:vciId, vat_challan_id:vchId, product_id:r.product_id, purchase_order_item_id:r.id, po_qty_consumed:r.qty_ordered, qty:r.qty_ordered,
          rate:r.rate, vat_pct:15, line_subtotal:r.line_subtotal, vat_amount:r.line_vat,
          line_total:r.line_total, sort_order:idx });
        // Delivery Challan (one per product)
        dcc++;
        const dcId = U();
        DCs.push({ id:dcId, dc_number:`DC-${fyTag}-${String(dcc).padStart(5,"0")}`, dc_date:vchDate,
          vat_challan_id:vchId, vat_challan_item_id:vciId, product_id:r.product_id, qty:r.qty_ordered,
          customer_id:cust.id, status:dcStatus, branch_id:BR, created_by:UID });
        if (stage >= 1) {
          CRs.push({ id:U(), delivery_challan_id:dcId,
            receive_date:ymd(new Date(new Date(vchDate).getTime() + RI(1,2)*86400000)),
            received_by_name:cust.name, transport_info:"Truck", created_by:UID });
        }
        if (stage >= 2) {
          HRs.push({ id:U(), delivery_challan_id:dcId,
            ho_receive_date:ymd(new Date(new Date(vchDate).getTime() + RI(3,5)*86400000)),
            verified_by:UID, missing_flag:false });
        }
      });

      // Invoice v2 — only for stages 3 & 4
      if (stage < 3) continue;

      inv2c++;
      const invId = U();
      const invNum = `INV2-${fyTag}-${String(inv2c).padStart(5,"0")}`;
      const invDate = ymd(new Date(new Date(vchDate).getTime() + RI(5,10)*86400000));
      const fullyPaid = stage === 3;
      const tdsAmt = fullyPaid ? round2(poSub * 0.05) : (R() < 0.5 ? round2(poSub * 0.05) : 0);
      const paidAmt = fullyPaid ? round2(poGrand - tdsAmt) : (R() < 0.5 ? round2((poGrand - tdsAmt) * 0.5) : 0);
      const dueAmt = round2(poGrand - paidAmt - tdsAmt);
      const invStatus = dueAmt <= 0.01 ? "paid" : (paidAmt > 0 ? "partial" : "issued");
      const invVid = addV("journal", invDate, `Tax Invoice ${invNum}`, [
        [Ac.ar, poGrand, 0, `AR ${invNum}`],
        [Ac.sales, 0, round2(poSub), `Sales ${invNum}`],
        [Ac.vatOut, 0, round2(poVat), `Output VAT ${invNum}`],
      ]);
      INV2.push({ id:invId, invoice_number:invNum, invoice_date:invDate, customer_id:cust.id, mode:"single",
        subtotal:round2(poSub), vat_total:round2(poVat), grand_total:poGrand,
        paid_amount:paidAmt, tds_amount:tdsAmt, due_amount:dueAmt, status:invStatus, voucher_id:invVid,
        branch_id:BR, financial_year_id:FY, created_by:UID });
      poiData.forEach((r,idx) => {
        INV2items.push({ id:U(), invoice_id:invId, product_id:r.product_id, qty:r.qty_ordered, rate:r.rate,
          vat_pct:15, line_subtotal:r.line_subtotal, vat_amount:r.line_vat, line_total:r.line_total,
          source_vat_challan_item_id: vciByProduct[r.product_id], sort_order:idx });
      });
      INVCHs.push({ id:U(), invoice_id:invId, vat_challan_id:vchId });

      // Invoice Payment
      if (paidAmt > 0) {
        ipayc++;
        const ipId = U();
        const ipNum = `RCP-${fyTag}-${String(ipayc).padStart(5,"0")}`;
        const ipDate = ymd(new Date(new Date(invDate).getTime() + RI(7,30)*86400000));
        const mode = pick(["bank","cash","cheque","online"]);
        const cashDr = mode === "cash" ? Ac.cash : Ac.bank;
        const entries: [string,number,number,string][] = [[cashDr, paidAmt, 0, `Receipt ${ipNum}`]];
        if (tdsAmt > 0) entries.push([Ac.tdsr, tdsAmt, 0, "TDS deducted"]);
        entries.push([Ac.ar, 0, round2(paidAmt + tdsAmt), `AR settle ${invNum}`]);
        const ipVid = addV("receipt", ipDate, `Invoice Payment ${ipNum}`, entries);
        IPAYs.push({ id:ipId, payment_number:ipNum, invoice_id:invId, payment_date:ipDate, mode,
          amount_received:paidAmt, tds_amount:tdsAmt, total_settled:round2(paidAmt+tdsAmt),
          reference:`TXN-${ipayc}`, voucher_id:ipVid, branch_id:BR, financial_year_id:FY, created_by:UID });
        if (tdsAmt > 0) {
          tdsc++;
          TDSs.push({ id:U(), invoice_id:invId, payment_id:ipId, tds_pct:5, tds_amount:tdsAmt,
            certificate_no:`TDS-${fyTag}-${String(tdsc).padStart(5,"0")}`, certificate_date:ipDate,
            voucher_id:ipVid, created_by:UID });
        }
      }
    }
    // Flush vouchers/entries added during sales-workflow loop before dependent rows
    // such as sales_invoices_v2, invoice_payments and tds_entries reference voucher_id.
    await bulk("acc_vouchers", vouchers.slice(vouchersFlushedTo), 400);
    await bulk("voucher_entries", ventries.slice(ventriesFlushedTo), 600);

    await bulk("purchase_orders", POs);
    await bulk("purchase_order_items", POitems);
    await bulk("vat_challans", VCHs);
    await bulk("vat_challan_items", VCHitems);
    await bulk("delivery_challans", DCs);
    await bulk("customer_receives", CRs);
    await bulk("ho_receives", HRs);
    await bulk("sales_invoices_v2", INV2);
    await bulk("sales_invoice_items_v2", INV2items);
    await bulk("invoice_challans", INVCHs);
    await bulk("invoice_payments", IPAYs);
    await bulk("tds_entries", TDSs);

    // ===== Number sequences (upsert — Document Numbering is protected from reset) =====
    {
      const seqRows = [
        { id:"sales_invoice", prefix:"INV", current_number:sc, year: Number(fyTag), description:"Sales Invoice" },
        { id:"sales_return", prefix:"SRN", current_number:src, year: Number(fyTag), description:"Sales Return" },
        { id:"production", prefix:"PRD", current_number:prdc, year: Number(fyTag), description:"Production" },
        { id:"stock_transfer", prefix:"STR", current_number:tc, year: Number(fyTag), description:"Stock Transfer" },
        { id:"journal_voucher", prefix:"JV", current_number:vc.JV, year: Number(fyTag), description:"Journal Voucher" },
        { id:"payment_voucher", prefix:"PV", current_number:vc.PV, year: Number(fyTag), description:"Payment Voucher" },
        { id:"receipt_voucher", prefix:"RV", current_number:vc.RV, year: Number(fyTag), description:"Receipt Voucher" },
        { id:"contra_voucher", prefix:"CV", current_number:vc.CV, year: Number(fyTag), description:"Contra Voucher" },
        { id:"purchase_order", prefix:"PO", current_number:poc, year: Number(fyTag), description:"Customer Purchase Order" },
        { id:"vat_challan", prefix:"VCH", current_number:vchc, year: Number(fyTag), description:"VAT Challan (Mushak 6.3)" },
        { id:"delivery_challan", prefix:"DC", current_number:dcc, year: Number(fyTag), description:"Delivery Challan" },
        { id:"sales_invoice_v2", prefix:"INV2", current_number:inv2c, year: Number(fyTag), description:"Consolidated Sales Invoice" },
        { id:"invoice_payment", prefix:"RCP", current_number:ipayc, year: Number(fyTag), description:"Invoice Payment Receipt" },
        { id:"tds_entry", prefix:"TDS", current_number:tdsc, year: Number(fyTag), description:"TDS Entry" },
      ];
      const { error: seqErr } = await db.from("number_sequences").upsert(seqRows, { onConflict: "id" });
      if (seqErr) log.push(`number_sequences upsert: ${seqErr.message}`);
    }

    // ===== Demo Party Notes (showcase party notes feature) =====
    const noteSnippets = [
      "Reliable client — pays within 15 days.",
      "Requested quarterly statement.",
      "Prefers delivery before noon.",
      "Negotiated 2% discount on bulk orders.",
      "Phone updated; check before next billing.",
    ];
    const partyNotes: any[] = [];
    for (const c of customers.slice(0, 8)) {
      partyNotes.push({
        id: U(), party_id: c.id, party_type: "customer",
        note: pick(noteSnippets), created_by: UID,
      });
    }
    for (const s of suppliers.slice(0, 5)) {
      partyNotes.push({
        id: U(), party_id: s.id, party_type: "supplier",
        note: pick(noteSnippets), created_by: UID,
      });
    }
    await bulk("party_notes", partyNotes);

    await db.from("audit_log").insert({
      user_id: UID, user_name: user.email,
      action: "demo_reset_and_seed", module: "backup",
      details: `Demo reset + full-year seed completed in ${Date.now() - t0}ms (FY ${fyName})`,
    });



    return new Response(JSON.stringify({
      success: true,
      duration_ms: Date.now() - t0,
      stats: {
        financial_year: fyName,
        sales: sc, purchases: pc, sales_returns: src, purchase_returns: prc,
        payments: pays.length, vouchers: vouchers.length, voucher_entries: ventries.length,
        payroll: payroll.length, fund_transactions: fundTx.length,
        attendance: att.length, leave_requests: leaves.length,
        stock_transfers: tc, boms: boms.length, production: prdc,
        products: products.length, customers: customers.length, suppliers: suppliers.length, employees: employees.length,
        purchase_orders: poc, vat_challans: vchc, delivery_challans: dcc,
        purchase_orders_v2: poc2, purchase_requisitions: prq, grns: grnc,
        supplier_bills: sbc, supplier_payments: spc, purchase_returns_v2: prc, lc_documents: lcc,
        invoices_v2: inv2c, invoice_payments: ipayc, tds_entries: tdsc,
        party_notes: partyNotes.length,
      },
      log,
    }), { headers: { ...corsHeaders, "Content-Type":"application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message, log }),
      { status: 400, headers: { ...corsHeaders, "Content-Type":"application/json" } });
  }
});
