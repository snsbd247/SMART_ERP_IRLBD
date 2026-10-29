import { dataClient } from "@/integrations/data/client";

/**
 * Update warehouse stock for an item.
 * Positive qty = increase, negative qty = decrease.
 */
export async function updateWarehouseStock(
  itemId: string,
  warehouseId: string,
  quantityChange: number
) {
  const { data: existing } = await dataClient
    .from("warehouse_stock")
    .select("id, quantity")
    .eq("item_id", itemId)
    .eq("warehouse_id", warehouseId)
    .single();

  if (existing) {
    const newQty = Number((existing as any).quantity) + quantityChange;
    await dataClient
      .from("warehouse_stock")
      .update({ quantity: newQty, updated_at: new Date().toISOString() } as any)
      .eq("id", (existing as any).id);
  } else {
    await dataClient.from("warehouse_stock").insert({
      item_id: itemId,
      warehouse_id: warehouseId,
      quantity: quantityChange,
    });
  }
}

/**
 * Look up stock_group_id for a product/item by its id (cached per call set).
 */
export async function getStockGroupIdForItem(itemId: string): Promise<string | null> {
  if (!itemId) return null;
  const { data } = await dataClient
    .from("item_master")
    .select("stock_group_id")
    .eq("id", itemId)
    .maybeSingle();
  return (data as any)?.stock_group_id || null;
}

/**
 * Create a stock movement record for the stock ledger.
 * Automatically tags the movement with the product's stock_group_id when not provided.
 */
export async function createStockMovement(params: {
  product_id: string;
  item_id?: string;
  warehouse_id?: string;
  branch_id?: string | null;
  movement_type: string;
  reference_type?: string;
  reference_id?: string;
  quantity: number;
  stock_group_id?: string | null;
}) {
  let stockGroupId = params.stock_group_id ?? null;
  if (stockGroupId === null) {
    stockGroupId = await getStockGroupIdForItem(params.item_id || params.product_id);
  }
  const { error } = await dataClient.from("stock_movements").insert({
    product_id: params.product_id,
    item_id: params.item_id || null,
    warehouse_id: params.warehouse_id || null,
    branch_id: params.branch_id || null,
    movement_type: params.movement_type,
    reference_type: params.reference_type || null,
    reference_id: params.reference_id || null,
    quantity: params.quantity,
    stock_group_id: stockGroupId,
  } as any);
  if (error) throw new Error("Failed to create stock movement: " + error.message);
}

/**
 * Bulk-enrich a list of movement rows with stock_group_id derived from item_master.
 * Returns a new list; mutates nothing. Uses a single batched query.
 */
export async function enrichMovementsWithStockGroup<T extends { product_id?: string; item_id?: string; stock_group_id?: string | null }>(
  rows: T[]
): Promise<T[]> {
  const ids = Array.from(new Set(rows.map((r) => r.item_id || r.product_id).filter(Boolean) as string[]));
  if (!ids.length) return rows;
  const { data } = await dataClient.from("item_master").select("id, stock_group_id").in("id", ids);
  const map = new Map<string, string | null>((data || []).map((d: any) => [d.id, d.stock_group_id]));
  return rows.map((r) => ({
    ...r,
    stock_group_id: r.stock_group_id ?? map.get((r.item_id || r.product_id) as string) ?? null,
  }));
}
