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
  let MODE: "reset" | "reset-and-seed" = "reset-and-seed";
  try { const b = await req.clone().json(); if (b?.mode === "reset") MODE = "reset"; } catch {}
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

    // ===== RESET =====
    const resetGroups: string[][] = [
      ["voucher_entries","payment_allocations","sales_invoice_items","sales_return_items","purchase_items","purchase_return_items","stock_movements","stock_ledger","stock_transfers","production_materials","bom_items","fund_transactions","employee_fund_settings","overtime_records","leave_requests","attendance","employee_documents","employee_bank_info","employee_education","employee_experience","employee_emergency_contacts","salary_structures","face_data","biometric_logs","payroll","party_notes","audit_log","login_logs","backup_history","messages","conversation_participants",
        "tds_entries","invoice_payments","invoice_challans","sales_invoice_items_v2","customer_receives","ho_receives","vat_challan_items","purchase_order_items",
        // Status logs / amendments — defensive (cascade would also handle these)
        "invoice_status_logs","po_amendments"],
      // Returns must be deleted BEFORE their parent invoices/purchases
      ["sales_returns","purchase_returns"],
      ["sales_invoices_v2","delivery_challans","vat_challans","purchase_orders"],
      ["acc_vouchers","party_payments","sales_invoices","purchases","production_entries","bill_of_materials","employees","conversations"],
      ["customers","suppliers","item_master","products","raw_materials"],
      ["item_categories","units","warehouses","product_categories"],
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
    const ud: [string,string][] = [["PCS","Pieces"],["KG","Kilogram"],["LTR","Litre"],["BOX","Box"],["MTR","Meter"]];
    const uIds: Record<string,string> = {};
    await bulk("units", ud.map(([a,n]) => { const id=U(); uIds[a]=id; return {id,name:n,abbreviation:a}; }));

    // Categories
    const cd = ["Electronics","Office Supplies","Furniture","Stationery","Hardware"];
    const cIds: Record<string,string> = {};
    const catRows = cd.map(n => { const id=U(); cIds[n]=id; return {id,name:n}; });
    await bulk("product_categories", catRows);
    await bulk("item_categories", catRows.map(c => ({ ...c, is_active:true })));

    // Products
    const PD: [string,string,string,number,number][] = [
      ["Laptop Pro 15","Electronics","PCS",65000,85000],["Wireless Mouse","Electronics","PCS",450,750],
      ["Mechanical Keyboard","Electronics","PCS",2800,4500],["LED Monitor 24","Electronics","PCS",12000,17500],
      ["USB Hub 4-Port","Electronics","PCS",650,1100],["External SSD 1TB","Electronics","PCS",7500,10500],
      ["Printer Inkjet","Electronics","PCS",8500,12500],["Webcam HD","Electronics","PCS",2200,3500],
      ["Headphones BT","Electronics","PCS",1800,2900],["Power Bank 20000mAh","Electronics","PCS",1500,2400],
      ["A4 Paper Ream","Stationery","BOX",420,600],["Ballpoint Pen Box","Stationery","BOX",180,300],
      ["Stapler Heavy Duty","Office Supplies","PCS",650,950],["File Folder","Stationery","PCS",45,80],
      ["Notebook A5","Stationery","PCS",95,160],["Marker Set","Stationery","BOX",220,350],
      ["Office Chair","Furniture","PCS",8500,13500],["Executive Desk","Furniture","PCS",18500,26000],
      ["Filing Cabinet","Furniture","PCS",9500,14000],["Bookshelf","Furniture","PCS",7800,11500],
      ["UPS 1200VA","Electronics","PCS",5500,7800],["Router WiFi 6","Electronics","PCS",4200,6200],
      ["CAT6 Cable 305m","Hardware","BOX",6500,9200],["RJ45 Connector Pack","Hardware","BOX",350,550],
      ["Toner Cartridge","Office Supplies","PCS",3800,5500],["Light Bulb LED","Hardware","PCS",180,280],
      ["Drill Machine","Hardware","PCS",3800,5500],["Screwdriver Set","Hardware","BOX",850,1300],
      ["CCTV Camera","Electronics","PCS",4500,6500],["Hard Disk 4TB","Electronics","PCS",8500,11800],
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
      opening_stock:p.op, category_id:cIds[p.cat], unit_id:uIds[p.unit],
      cost_price:p.cp, selling_price:p.sp, min_stock_level:10, status:"active",
    })));

    // Customers / Suppliers
    const cn = ["Alpha Trading","Beta Enterprises","Gamma Corp","Delta Industries","Epsilon Ltd",
      "Zeta Solutions","Eta Holdings","Theta Group","Iota Tech","Kappa Foods",
      "Lambda Pharma","Mu Textiles","Nu Logistics","Xi Construction","Omicron Retail"];
    const customers = cn.map((n,i) => ({ id:U(), name:n, phone:`+8801${700000000+i*1111}`, email:n.toLowerCase().replace(/ /g,"")+"@example.com", address:"Dhaka, Bangladesh", status:"active" }));
    await bulk("customers", customers);
    const sn = ["ABC Suppliers","XYZ Wholesale","PQR Distributors","LMN Trading","EFG Imports",
      "HIJ Mfg","RST Enterprises","UVW Industries","BDS Tech","GreenLine Foods",
      "Metro Hardware","Capital Stationers"];
    const suppliers = sn.map((n,i) => ({ id:U(), name:n, phone:`+8801${800000000+i*2222}`, email:n.toLowerCase().replace(/ /g,"")+"@vendor.com", address:"Dhaka, Bangladesh", status:"active" }));
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
      department_id:DEPT, designation_id:DESIG, branch_id: i<10?BR_DHK:BR_CTG,
      joining_date:e.join, salary:e.basic, employment_type:"permanent", status:"active",
      employee_category:"staff",
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
        const items = pickN(products, RI(1,4));
        const invId = U();
        let subtotal = 0;
        const rows: [string,number,number,number,string][] = [];
        for (const p of items) {
          const qty = RI(1,8), price = p.sp, tot = qty*price;
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
      if (R() < 0.7) {
        const sup = pick(suppliers);
        const items = pickN(products, RI(1,3));
        const pId = U();
        let subtotal = 0;
        const rows: [string,number,number,number,string][] = [];
        for (const p of items) {
          const qty = RI(10,40), price = p.cp, tot = qty*price;
          subtotal += tot;
          rows.push([p.id,qty,price,tot,p.iid]);
        }
        const vat = round2(subtotal * VAT_RATE);
        const gross = round2(subtotal + vat);
        pc++;
        const pnum = `PUR-${fyTag}-${String(pc).padStart(5,"0")}`;
        const credit = R() < 0.6;
        pinv.push({ id:pId, purchase_number:pnum, purchase_date:ds, supplier_id:sup.id, branch_id:BR_DHK,
          total_amount:gross, payment_method:credit?"credit":"cash", status:"approved", created_by:UID });
        for (const r of rows) {
          pitems.push({ id:U(), purchase_id:pId, product_id:r[4], quantity:r[1], unit_price:r[2], total:r[3] });
          smov.push({ id:U(), product_id:r[4], item_id:r[4], warehouse_id:WH_DHK, branch_id:BR_DHK,
            movement_type:"purchase", reference_type:"purchase", reference_id:pId, quantity:r[1] });
        }
        const cr = credit ? Ac.ap : Ac.cash;
        addV(credit?"journal":"payment", ds, `Purchase ${pnum}`, [
          [Ac.pur, subtotal, 0, `Purchase from ${sup.name}`],
          [Ac.vatIn, vat, 0, `Input VAT ${pnum}`],
          [cr, 0, gross, `Purchase ${pnum}`],
        ]);
        pList.push({ id:pId, sid:sup.id, date:ds, subtotal, vat, gross, credit, num: pnum });
      }
    }

    await bulk("sales_invoices", sinv);
    await bulk("sales_invoice_items", sitems);
    await bulk("purchases", pinv);
    await bulk("purchase_items", pitems);
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

    // ===== Purchase Returns (random 4% of purchases) =====
    const pret: any[] = [], pretItems: any[] = [];
    let prc = 0;
    for (const p of pList) {
      if (R() > 0.04) continue;
      const items = pitems.filter(x => x.purchase_id === p.id);
      if (!items.length) continue;
      const rid = U(); prc++;
      const rnum = `PRN-${fyTag}-${String(prc).padStart(5,"0")}`;
      const retDate = ymd(new Date(new Date(p.date).getTime() + RI(3,12)*86400000));
      if (new Date(retDate) > end) continue;
      let retTotal = 0;
      for (const it of items) {
        const rqty = Math.max(1, Math.floor(it.quantity * 0.2));
        const tot = round2(rqty * it.unit_price);
        retTotal += tot;
        pretItems.push({ id:U(), purchase_return_id:rid, product_id:it.product_id, quantity:rqty, unit_price:it.unit_price, total:tot });
      }
      pret.push({ id:rid, return_number:rnum, return_date:retDate, purchase_id:p.id, supplier_id:p.sid, branch_id:BR_DHK, total_amount:retTotal, reason:"Damaged", status:"approved", created_by:UID });
      addV("journal", retDate, `Purchase Return ${rnum}`, [
        [Ac.ap, retTotal, 0, "AP reduction"],
        [Ac.purRet, 0, retTotal, "Purchase return"],
      ]);
    }
    await bulk("purchase_returns", pret);
    await bulk("purchase_return_items", pretItems);

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
    // Supplier payments
    for (const p of pList) {
      if (!p.credit) continue;
      if (R() < 0.72) {
        const pd = new Date(new Date(p.date).getTime() + RI(10,50)*86400000);
        if (pd > end) continue;
        const fullPay = R() < 0.8;
        const settled = fullPay ? p.gross : round2(p.gross * 0.5);
        const pid = U(); pmc++;
        const ref = `PAY-${fyTag}-${String(pmc).padStart(5,"0")}`;
        const method = pick(["cash","bank"]);
        pays.push({ id:pid, party_id:p.sid, party_type:"supplier", payment_date:ymd(pd),
          amount:settled, payment_method:method, reference:ref, created_by:UID });
        allocs.push({ id:U(), payment_id:pid, invoice_type:"purchase", invoice_id:p.id, allocated_amount:settled });
        const cashCr = method === "cash" ? Ac.cash : Ac.bank;
        addV("payment", ymd(pd), `Payment ${ref}`, [
          [Ac.ap, settled, 0, `AP settle ${p.num}`],
          [cashCr, 0, settled, "Supplier payment"],
        ]);
      }
    }
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

    // ===== Bill of Materials + Production =====
    const finished = products.slice(0, 4); // First 4 products as finished goods
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
          id:U(), bom_id:bid, material_id:r.id, quantity:2, unit:"PCS",
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

    // ===== Sales Workflow (BD VAT): PO → VAT Challan → DC → Receive → Invoice v2 → Payment + TDS =====
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
      const its  = pickN(products, RI(2,4));
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
    await bulk("dispatches", DSPs);
    await bulk("dispatch_items", DSPitems);
    await bulk("dispatch_po_allocations", DSPallocs);
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
        { id:"purchase", prefix:"PUR", current_number:pc, year: Number(fyTag), description:"Purchase" },
        { id:"sales_return", prefix:"SRN", current_number:src, year: Number(fyTag), description:"Sales Return" },
        { id:"purchase_return", prefix:"PRN", current_number:prc, year: Number(fyTag), description:"Purchase Return" },
        { id:"production", prefix:"PRD", current_number:prdc, year: Number(fyTag), description:"Production" },
        { id:"stock_transfer", prefix:"STR", current_number:tc, year: Number(fyTag), description:"Stock Transfer" },
        { id:"journal_voucher", prefix:"JV", current_number:vc.JV, year: Number(fyTag), description:"Journal Voucher" },
        { id:"payment_voucher", prefix:"PV", current_number:vc.PV, year: Number(fyTag), description:"Payment Voucher" },
        { id:"receipt_voucher", prefix:"RV", current_number:vc.RV, year: Number(fyTag), description:"Receipt Voucher" },
        { id:"contra_voucher", prefix:"CV", current_number:vc.CV, year: Number(fyTag), description:"Contra Voucher" },
        { id:"purchase_order", prefix:"PO", current_number:poc, year: Number(fyTag), description:"Customer Purchase Order" },
        { id:"dispatch", prefix:"DSP", current_number:dspc, year: Number(fyTag), description:"Dispatch / Gate Pass" },
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
        purchase_orders: poc, dispatches: dspc, vat_challans: vchc, delivery_challans: dcc,
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
