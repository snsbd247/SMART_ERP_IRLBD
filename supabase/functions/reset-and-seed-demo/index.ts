// Reset all transactional+master data and seed a full year of operational demo data
// for FY Jul 2024 - Jun 2025. Super-admin only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BR_DHK = "b0000000-0000-0000-0000-000000000001";
const BR_CTG = "b0000000-0000-0000-0000-000000000002";
const FY = "f1000000-0000-0000-0000-000000000002";
const ADMIN_UID = "7c0c8dfb-c23d-4fd9-9d67-d8322bd0eedb";

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const rint = (a: number, b: number) => Math.floor(rand() * (b - a + 1)) + a;
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const uuid = () => crypto.randomUUID();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) throw new Error("Missing authorization");
    const u = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: ae } = await u.auth.getUser();
    if (ae || !user) throw new Error("Unauthorized");
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: prof } = await admin.from("profiles").select("employee_id").eq("id", user.id).single();
    if (prof?.employee_id) throw new Error("Super Admin only");

    const resetTables = [
      "voucher_entries","acc_vouchers","payment_allocations","party_payments","party_notes",
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
      "audit_log","login_logs","backup_history","conversations","conversation_participants","messages",
      "number_sequences",
    ];
    for (const t of resetTables) {
      await admin.from(t).delete().not("id", "is", null);
    }
    await admin.from("profiles").delete().not("employee_id", "is", null);
    await admin.from("financial_years").update({ is_active: false }).neq("id", FY);
    await admin.from("financial_years").update({ is_active: true }).eq("id", FY);
    await admin.from("company_settings").update({
      default_financial_year_id: FY, default_branch_id: BR_DHK,
    }).eq("id", "default");

    const bulk = async (table: string, rows: any[], chunk = 500) => {
      for (let i = 0; i < rows.length; i += chunk) {
        const { error } = await admin.from(table).insert(rows.slice(i, i + chunk));
        if (error) throw new Error(`${table}: ${error.message}`);
      }
    };

    const WH_MAIN = uuid(), WH_CTG = uuid();
    await bulk("warehouses", [
      { id: WH_MAIN, warehouse_code: "WH-DHK", warehouse_name: "Dhaka Main Warehouse", branch_id: BR_DHK, status: "active" },
      { id: WH_CTG, warehouse_code: "WH-CTG", warehouse_name: "Chittagong Warehouse", branch_id: BR_CTG, status: "active" },
    ]);

    const unitDefs: [string, string][] = [["PCS","Pieces"],["KG","Kilogram"],["LTR","Litre"],["BOX","Box"],["MTR","Meter"]];
    const unitIds: Record<string,string> = {};
    await bulk("units", unitDefs.map(([a,n]) => { const id = uuid(); unitIds[a]=id; return {id,name:n,abbreviation:a}; }));

    const catDefs = ["Electronics","Office Supplies","Furniture","Stationery","Hardware"];
    const catIds: Record<string,string> = {};
    await bulk("item_categories", catDefs.map(n => { const id = uuid(); catIds[n]=id; return {id,name:n,is_active:true}; }));

    const productDefs: [string,string,string,number,number][] = [
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
      ["DVR 8 Channel","Electronics","PCS",9800,14000],["Hard Disk 4TB","Electronics","PCS",8500,11800],
    ];
    type Prod = { id: string; iid: string; code: string; name: string; cat: string; unit: string; cp: number; sp: number; opening: number };
    const products: Prod[] = productDefs.map((p, i) => ({
      id: uuid(), iid: uuid(), code: `PRD-${String(i+1).padStart(4,"0")}`,
      name: p[0], cat: p[1], unit: p[2], cp: p[3], sp: p[4], opening: rint(50,300),
    }));
    await bulk("products", products.map(p => ({
      id: p.id, product_code: p.code, product_name: p.name, category_id: catIds[p.cat],
      unit: p.unit, cost_price: p.cp, selling_price: p.sp, low_stock_threshold: 10, status: "active",
    })));
    await bulk("item_master", products.map(p => ({
      id: p.iid, item_code: p.code, item_name: p.name, item_type: "product", is_stock_item: true,
      opening_stock: p.opening, category_id: catIds[p.cat], unit_id: unitIds[p.unit],
      cost_price: p.cp, selling_price: p.sp, min_stock_level: 10, status: "active",
    })));

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
