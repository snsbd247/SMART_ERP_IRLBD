import StockVoucherPage from "@/components/inventory/StockVoucherPage";

export default function StockDamagePage() {
  return (
    <StockVoucherPage
      config={{
        title: "Stock Damage",
        entryTable: "stock_damage_entries",
        itemTable: "stock_damage_items",
        sequenceId: "stock_damage",
        movementType: "damage",
        referenceType: "stock_damage_entry",
        direction: -1,
      }}
    />
  );
}
