// Reset all transactional+master data and seed a year of demo data (FY Jul 2024-Jun 2025).
// Super-admin only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BR_DHK = "b0000000-0000-0000-0000-000000000001";
const BR_CTG = "b0000000-0000-0000-0000-000000000002";
const FY = "f1000000-0000-0000-0000-000000000002";
const DEPT = "40b7a375-7827-4752-b2ab-15991a13c430";
const DESIG = "90d518b7-b03e-4c07-88db-421ab6db7bca";
const UID = "7c0c8dfb-c23d-4fd9-9d67-d8322bd0eedb";
const A = {
  cash:"5fcabca6-ad7d-436f-991d-3ea57d09198e", bank:"82823396-f97f-4295-9f0a-c9418458fc4b",
  ar:"ed725e57-7f0f-441f-b981-03d57443a363", inv:"c552c2d5-9daa-4b56-8a00-50db1e15bcaf",
  ap:"9a16b74b-573d-47ea-b8d3-3bfe78424bc1", sales:"8f7b0829-080c-4bb4-be75-b271e9b950a1",
  pur:"7160faf2-a471-4c96-b3f3-be9bc75b37ea", sal:"a5fb9d18-6892-4bc6-a948-fe5a4b499664",
  rent:"2aa4bf3f-2450-4e9a-af2d-9df7b4708ef2", util:"d896464c-2148-4a64-a4aa-aa3e90af5e2e",
  off:"893dedd4-c0aa-4083-bbbd-bfdf12b823c8", tr:"3fda3441-27d5-4acd-8175-e2b7e66f361e",
  cap:"bf57cf5e-8032-4bc0-954d-60120b027993",
};

let _s = 42;
const R = () => { _s|=0; _s=(_s+0x6D2B79F5)|0; let t=Math.imul(_s^(_s>>>15),1|_s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
const RI = (a:number,b:number) => Math.floor(R()*(b-a+1))+a;
const pick = <T,>(a:T[]):T => a[Math.floor(R()*a.length)];
const pickN = <T,>(a:T[], n:number):T[] => { const c=[...a],o:T[]=[]; for(let i=0;i<n&&c.length;i++) o.push(c.splice(Math.floor(R()*c.length),1)[0]); return o; };
const U = () => crypto.randomUUID();
const ymd = (d:Date) => d.toISOString().slice(0,10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const log: string[] = [];
  try {
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

    // ===== RESET =====
    const reset = ["voucher_entries","acc_vouchers","payment_allocations","party_payments","party_notes",
      "sales_invoice_items","sales_invoices","sales_return_items","sales_returns",
      "purchase_items","purchases","purchase_return_items","purchase_returns",
      "stock_movements","stock_ledger","stock_transfers",
      "production_materials","production_entries","bom_items","bill_of_materials",
      "fund_transactions","employee_fund_settings","payroll","overtime_records",
      "leave_requests","attendance",
      "employee_documents","employee_bank_info","employee_education","employee_experience",
      "employee_emergency_contacts","salary_structures","face_data","biometric_logs","employees",
      "customers","suppliers",
      "item_master","products","item_categories","units","warehouses","product_categories","raw_materials",
      "audit_log","login_logs","backup_history","conversations","conversation_participants","messages","number_sequences"];
    for (const t of reset) {
      const { error } = await db.from(t).delete().not("id", "is", null);
      if (error) log.push(`del ${t}: ${error.message}`);
    }
    await db.from("profiles").delete().not("employee_id", "is", null);

    await db.from("financial_years").update({ is_active: false }).neq("id", FY);
    await db.from("financial_years").update({ is_active: true }).eq("id", FY);
    await db.from("company_settings").update({ default_financial_year_id: FY, default_branch_id: BR_DHK }).eq("id", "default");

    const bulk = async (t: string, rows: any[], ch = 500) => {
      for (let i = 0; i < rows.length; i += ch) {
        const { error } = await db.from(t).insert(rows.slice(i, i + ch));
        if (error) throw new Error(`${t}: ${error.message}`);
      }
    };

    // Warehouses
    const WH = U(), WHC = U();
    await bulk("warehouses", [
      { id: WH, warehouse_code: "WH-DHK", warehouse_name: "Dhaka Main Warehouse", branch_id: BR_DHK, status: "active" },
      { id: WHC, warehouse_code: "WH-CTG", warehouse_name: "Chittagong Warehouse", branch_id: BR_CTG, status: "active" },
    ]);

    // Units
    const ud: [string,string][] = [["PCS","Pieces"],["KG","Kilogram"],["LTR","Litre"],["BOX","Box"],["MTR","Meter"]];
    const uIds: Record<string,string> = {};
    await bulk("units", ud.map(([a,n]) => { const id=U(); uIds[a]=id; return {id,name:n,abbreviation:a}; }));

    // Categories (seed both product_categories for products FK and item_categories for item_master)
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
      ["Sticky Notes","Stationery","PCS",60,110],["Calculator","Office Supplies","PCS",850,1300],
      ["Office Chair","Furniture","PCS",8500,13500],["Executive Desk","Furniture","PCS",18500,26000],
      ["Filing Cabinet","Furniture","PCS",9500,14000],["Bookshelf","Furniture","PCS",7800,11500],
      ["Conference Table","Furniture","PCS",32000,45000],["Reception Sofa","Furniture","PCS",24000,35000],
      ["Whiteboard 4x6","Office Supplies","PCS",2200,3500],["Projector","Electronics","PCS",38000,52000],
      ["Screen Tripod","Office Supplies","PCS",4500,6800],["UPS 1200VA","Electronics","PCS",5500,7800],
      ["Router WiFi 6","Electronics","PCS",4200,6200],["Network Switch 8port","Electronics","PCS",2800,4100],
      ["CAT6 Cable 305m","Hardware","BOX",6500,9200],["RJ45 Connector Pack","Hardware","BOX",350,550],
      ["Toner Cartridge","Office Supplies","PCS",3800,5500],["Document Scanner","Electronics","PCS",12500,17500],
      ["Shredder","Office Supplies","PCS",6800,9500],["Tea Bag Box","Office Supplies","BOX",280,420],
      ["Coffee Pack 1kg","Office Supplies","KG",850,1250],["Water Bottle 20L","Office Supplies","PCS",180,280],
      ["Hand Sanitizer 5L","Office Supplies","LTR",650,950],["Tissue Box","Office Supplies","BOX",75,130],
      ["Light Bulb LED","Hardware","PCS",180,280],["Extension Cord 10m","Hardware","MTR",420,650],
      ["Drill Machine","Hardware","PCS",3800,5500],["Screwdriver Set","Hardware","BOX",850,1300],
      ["Measuring Tape","Hardware","PCS",180,280],["Safety Helmet","Hardware","PCS",450,720],
      ["First Aid Kit","Office Supplies","PCS",850,1280],["CCTV Camera","Electronics","PCS",4500,6500],
      ["DVR 8 Channel","Electronics","PCS",9800,14000],["Hard Disk 4TB","Electronics","PCS",8500,11800]];
    type P = { id:string; iid:string; code:string; name:string; cat:string; unit:string; cp:number; sp:number; op:number };
    const products: P[] = PD.map((p,i) => ({
      id: U(), iid: U(), code: `PRD-${String(i+1).padStart(4,"0")}`,
      name: p[0], cat: p[1], unit: p[2], cp: p[3], sp: p[4], op: RI(50,300),
    }));
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
      "Lambda Pharma","Mu Textiles","Nu Logistics","Xi Construction","Omicron Retail",
      "Pi Services","Rho Distributors","Sigma Wholesale","Tau Imports","Upsilon Exports"];
    const customers = cn.map((n,i) => ({ id:U(), name:n, phone:`+8801${700000000+i*1111}`, email:n.toLowerCase().replace(/ /g,"")+"@example.com", address:"Dhaka, Bangladesh", status:"active" }));
    await bulk("customers", customers);
    const sn = ["ABC Suppliers","XYZ Wholesale","PQR Distributors","LMN Trading","EFG Imports",
      "HIJ Mfg","RST Enterprises","UVW Industries","BDS Tech","GreenLine Foods",
      "Metro Hardware","Capital Stationers","National Electronics","Prime Furniture","Smart IT Hub"];
    const suppliers = sn.map((n,i) => ({ id:U(), name:n, phone:`+8801${800000000+i*2222}`, email:n.toLowerCase().replace(/ /g,"")+"@vendor.com", address:"Dhaka, Bangladesh", status:"active" }));
    await bulk("suppliers", suppliers);

    // Employees + salary structures
    const fns = ["Rahim","Karim","Salam","Hasan","Nasir","Jamil","Tarek","Imran","Farhad","Mizan","Fatema","Nasrin","Sumi","Ayesha","Rabeya","Shahnaz","Mim","Tania","Lima","Sabina"];
    const lns = ["Ahmed","Khan","Hossain","Islam","Rahman","Chowdhury","Akter","Begum","Sultana","Hoque","Ahmed","Khan","Hossain","Islam","Rahman","Chowdhury","Akter","Begum","Sultana","Hoque"];
    const basicChoices = [18000,22000,28000,35000,45000,55000];
    type E = { id:string; code:string; basic:number; join:string; name:string };
    const employees: E[] = fns.map((fn,i) => {
      const basic = pick(basicChoices);
      const join = i < 10 ? "2024-01-01" : `2024-0${RI(2,6)}-01`;
      return { id: U(), code: `EMP-${1000+i+1}`, basic, join, name: `${fn} ${lns[i]}` };
    });
    await bulk("employees", employees.map((e,i) => ({
      id:e.id, employee_code:e.code, first_name:fns[i], last_name:lns[i],
      mobile:`+8801${900000000+i*333}`, email:fns[i].toLowerCase()+"@erp.com",
      department_id:DEPT, designation_id:DESIG, branch_id: i<14?BR_DHK:BR_CTG,
      joining_date:e.join, salary:e.basic, employment_type:"permanent", status:"active",
    })));
    await bulk("salary_structures", employees.map(e => {
      const hr = Math.floor(e.basic*0.4), med = Math.floor(e.basic*0.1), oth = Math.floor(e.basic*0.05);
      return { id:U(), employee_id:e.id, basic_salary:e.basic, house_rent:hr, medical_allowance:med, other_allowance:oth, total_salary:e.basic+hr+med+oth, effective_from:e.join };
    }));

    // ===== Voucher generator =====
    const vc = { JV:0, PV:0, RV:0, CV:0 } as Record<string,number>;
    const vouchers: any[] = [];
    const ventries: any[] = [];
    const addV = (vtype: string, vdate: string, desc: string, entries: [string,number,number,string][]) => {
      const vid = U();
      const total = entries.reduce((s,e) => s+e[1], 0);
      const pmap: Record<string,string> = { journal:"JV", payment:"PV", receipt:"RV", contra:"CV" };
      const pfx = pmap[vtype]; vc[pfx]++;
      const vn = `${pfx}-2425-${String(vc[pfx]).padStart(5,"0")}`;
      vouchers.push({ id:vid, voucher_number:vn, voucher_type:vtype, voucher_date:vdate, description:desc,
        total_amount:total, status:"approved", branch_id:BR_DHK, financial_year_id:FY,
        created_by:UID, approved_by:UID, approved_at:vdate });
      entries.forEach((e,idx) => ventries.push({ id:U(), voucher_id:vid, account_id:e[0], debit:e[1], credit:e[2], narration:e[3], sort_order:idx }));
    };

    // Opening
    const invOpen = products.reduce((s,p) => s+p.cp*p.op, 0);
    const cashOp = 200000, bankOp = 800000, apOp = 150000;
    const capital = cashOp+bankOp+invOpen-apOp;
    addV("journal","2024-07-01","Opening Balance Entry",[
      [A.cash,cashOp,0,"Opening cash"],[A.bank,bankOp,0,"Opening bank"],
      [A.inv,invOpen,0,"Opening inventory"],[A.ap,0,apOp,"Opening payables"],
      [A.cap,0,capital,"Owner capital"],
    ]);

    // Generate daily transactions
    const start = new Date("2024-07-01"), end = new Date("2025-06-30");
    const sinv: any[] = [], sitems: any[] = [], pinv: any[] = [], pitems: any[] = [], smov: any[] = [];
    type SI = { id:string; cid:string; date:string; net:number; cash:boolean };
    type PI = { id:string; sid:string; date:string; total:number; credit:boolean };
    const sList: SI[] = [], pList: PI[] = [];
    let sc=0, pc=0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) {
      if (d.getDay() === 5) continue; // Friday off
      const ds = ymd(d);
      const dayCount = RI(2,5);
      for (let j = 0; j < dayCount; j++) {
        const cust = pick(customers);
        const items = pickN(products, RI(1,4));
        const invId = U();
        let total = 0;
        const rows: [string,number,number,number,string][] = [];
        for (const p of items) {
          const qty = RI(1,8), price = p.sp, tot = qty*price;
          total += tot;
          rows.push([p.id,qty,price,tot,p.iid]);
        }
        const disc = Math.round(total * pick([0,0,0.02,0.05]) * 100)/100;
        const net = total - disc;
        sc++;
        const inum = `INV-2425-${String(sc).padStart(5,"0")}`;
        sinv.push({ id:invId, invoice_number:inum, invoice_date:ds, customer_id:cust.id, branch_id:BR_DHK,
          total_amount:total, discount:disc, net_amount:net, status:"approved", created_by:UID });
        for (const r of rows) {
          sitems.push({ id:U(), sales_invoice_id:invId, product_id:r[4], quantity:r[1], price:r[2], discount:0, total:r[3] });
          smov.push({ id:U(), product_id:r[4], item_id:r[4], warehouse_id:WH, branch_id:BR_DHK,
            movement_type:"sale", reference_type:"sales_invoice", reference_id:invId, quantity:r[1] });
        }
        const cash = R() < 0.4;
        const dr = cash ? A.cash : A.ar;
        addV(cash ? "receipt" : "journal", ds, `Sales Invoice ${inum}`,
          [[dr,net,0,`Sale to ${cust.name}`],[A.sales,0,net,`Revenue ${inum}`]]);
        sList.push({ id:invId, cid:cust.id, date:ds, net, cash });
      }
      if (R() < 0.85) {
        const sup = pick(suppliers);
        const items = pickN(products, RI(1,3));
        const pId = U();
        let total = 0;
        const rows: [string,number,number,number,string][] = [];
        for (const p of items) {
          const qty = RI(10,50), price = p.cp, tot = qty*price;
          total += tot;
          rows.push([p.id,qty,price,tot,p.iid]);
        }
        pc++;
        const pnum = `PO-2425-${String(pc).padStart(5,"0")}`;
        const credit = R() < 0.6;
        pinv.push({ id:pId, purchase_number:pnum, purchase_date:ds, supplier_id:sup.id, branch_id:BR_DHK,
          total_amount:total, payment_method:credit?"credit":"cash", status:"approved", created_by:UID });
        for (const r of rows) {
          pitems.push({ id:U(), purchase_id:pId, product_id:r[0], quantity:r[1], unit_price:r[2], total:r[3] });
          smov.push({ id:U(), product_id:r[0], item_id:r[4], warehouse_id:WH, branch_id:BR_DHK,
            movement_type:"in", reference_type:"purchase", reference_id:pId, quantity:r[1] });
        }
        const cr = credit ? A.ap : A.cash;
        addV(credit?"journal":"payment", ds, `Purchase ${pnum}`,
          [[A.pur,total,0,`Purchase from ${sup.name}`],[cr,0,total,`Purchase ${pnum}`]]);
        pList.push({ id:pId, sid:sup.id, date:ds, total, credit });
      }
    }

    // Insert sales/purchases/movements
    await bulk("sales_invoices", sinv);
    await bulk("sales_invoice_items", sitems);
    await bulk("purchases", pinv);
    await bulk("purchase_items", pitems);
    await bulk("stock_movements", smov);

    // Payments (customer)
    const pays: any[] = [], allocs: any[] = [];
    let pmc = 0;
    for (const s of sList) {
      if (s.cash) continue;
      if (R() < 0.75) {
        const inv = new Date(s.date);
        const pd = new Date(inv.getTime() + RI(7,45)*86400000);
        if (pd > end) continue;
        const amt = Math.round(s.net * pick([0.5,1.0,1.0,1.0]) * 100)/100;
        const pid = U(); pmc++;
        pays.push({ id:pid, party_id:s.cid, party_type:"customer", payment_date:ymd(pd),
          amount:amt, payment_method:"cash", reference:`REC-${String(pmc).padStart(5,"0")}`, created_by:UID });
        allocs.push({ id:U(), payment_id:pid, invoice_type:"sales", invoice_id:s.id, allocated_amount:amt });
        addV("receipt", ymd(pd), "Receipt from customer",
          [[A.cash,amt,0,"Customer payment"],[A.ar,0,amt,"AR settlement"]]);
      }
    }
    for (const p of pList) {
      if (!p.credit) continue;
      if (R() < 0.7) {
        const pd = new Date(new Date(p.date).getTime() + RI(10,50)*86400000);
        if (pd > end) continue;
        const amt = Math.round(p.total * pick([0.5,1.0,1.0]) * 100)/100;
        const pid = U(); pmc++;
        pays.push({ id:pid, party_id:p.sid, party_type:"supplier", payment_date:ymd(pd),
          amount:amt, payment_method:"cash", reference:`PAY-${String(pmc).padStart(5,"0")}`, created_by:UID });
        allocs.push({ id:U(), payment_id:pid, invoice_type:"purchase", invoice_id:p.id, allocated_amount:amt });
        addV("payment", ymd(pd), "Payment to supplier",
          [[A.ap,amt,0,"AP settlement"],[A.cash,0,amt,"Supplier payment"]]);
      }
    }
    await bulk("party_payments", pays);
    await bulk("payment_allocations", allocs);

    // Monthly expenses + payroll
    const months: Date[] = [];
    for (let m = new Date(2024,6,1); m <= end; m = new Date(m.getFullYear(), m.getMonth()+1, 1)) months.push(m);
    for (const m of months) {
      const ed = ymd(new Date(m.getFullYear(), m.getMonth(), RI(3,7)));
      const rent=45000, util=RI(8000,15000), off=RI(5000,12000), tr=RI(4000,10000);
      addV("payment", ed, "Monthly Rent", [[A.rent,rent,0,"Office rent"],[A.cash,0,rent,"Rent paid"]]);
      addV("payment", ed, "Utility Bills", [[A.util,util,0,"Electricity/Internet"],[A.cash,0,util,"Utility paid"]]);
      addV("payment", ed, "Office Expenses", [[A.off,off,0,"Office supplies"],[A.cash,0,off,"Office paid"]]);
      addV("payment", ed, "Transportation", [[A.tr,tr,0,"Transport"],[A.cash,0,tr,"Transport paid"]]);
    }
    const payroll: any[] = [];
    for (const m of months) {
      const eom = new Date(m.getFullYear(), m.getMonth()+1, 0);
      const pd = ymd(eom);
      let tot = 0;
      for (const e of employees) {
        if (new Date(e.join) > m) continue;
        const hr=Math.floor(e.basic*0.4), med=Math.floor(e.basic*0.1), oth=Math.floor(e.basic*0.05);
        const ded = pick([0,0,500,1000]);
        const net = e.basic+hr+med+oth-ded;
        tot += net;
        payroll.push({ id:U(), employee_id:e.id, month:m.getMonth()+1, year:m.getFullYear(),
          basic_salary:e.basic, allowances:hr+med+oth, deductions:ded, net_salary:net, status:"paid" });
      }
      addV("payment", pd, `Payroll ${m.toLocaleString("en",{month:"short",year:"numeric"})}`,
        [[A.sal,tot,0,`Salary for ${m.toLocaleString("en",{month:"long",year:"numeric"})}`],[A.bank,0,tot,"Salary disbursed"]]);
    }
    await bulk("payroll", payroll);

    // Vouchers & entries (insert at end)
    await bulk("acc_vouchers", vouchers, 400);
    await bulk("voucher_entries", ventries, 600);

    // Attendance
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

    // Number sequences
    await bulk("number_sequences", [
      { id:"sales_invoice", prefix:"INV", current_number:sc, year:2425, description:"Sales Invoice" },
      { id:"purchase", prefix:"PO", current_number:pc, year:2425, description:"Purchase" },
      { id:"journal_voucher", prefix:"JV", current_number:vc.JV, year:2425, description:"JV" },
      { id:"payment_voucher", prefix:"PV", current_number:vc.PV, year:2425, description:"PV" },
      { id:"receipt_voucher", prefix:"RV", current_number:vc.RV, year:2425, description:"RV" },
      { id:"contra_voucher", prefix:"CV", current_number:vc.CV, year:2425, description:"CV" },
    ]);

    return new Response(JSON.stringify({
      success: true,
      stats: { sales:sc, purchases:pc, payments:pays.length, vouchers:vouchers.length,
        payroll:payroll.length, attendance:att.length, products:products.length,
        customers:customers.length, suppliers:suppliers.length, employees:employees.length },
      log,
    }), { headers: { ...corsHeaders, "Content-Type":"application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: (err as Error).message, log }),
      { status: 400, headers: { ...corsHeaders, "Content-Type":"application/json" } });
  }
});
