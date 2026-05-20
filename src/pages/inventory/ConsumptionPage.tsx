import StockVoucherPage from "@/components/inventory/StockVoucherPage";

export default function ConsumptionPage() {
  return (
    <StockVoucherPage
      config={{
        title: "Consumption",
        entryTable: "consumption_entries",
        itemTable: "consumption_items",
        sequenceId: "consumption",
        movementType: "consumption",
        referenceType: "consumption_entry",
        direction: -1,
      }}
    />
  );
}
