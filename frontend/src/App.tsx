import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { LegacyRedirect } from "@/components/LegacyRedirect";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { BranchProvider } from "@/contexts/BranchContext";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { ModuleProvider } from "@/contexts/ModuleContext";
import { BrandingProvider } from "@/contexts/BrandingContext";
import { LicenseProvider } from "@/contexts/LicenseContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import { PageLoader } from "@/components/PageLoader";
import { lazyPage } from "@/lib/lazy-page";
import { Suspense } from "react";
import Login from "./pages/Login";
const PublicEmployeeRegistration = lazyPage(() => import("./pages/PublicEmployeeRegistration"));
const InstallPage = lazyPage(() => import("./pages/InstallPage"));
const LicenseVerificationPage = lazyPage(() => import("./pages/LicenseVerificationPage"));
const Dashboard = lazyPage(() => import("./pages/Dashboard"));
const VouchersPage = lazyPage(() => import("./pages/VouchersPage"));
const Profile = lazyPage(() => import("./pages/Profile"));
const UsersPage = lazyPage(() => import("./pages/admin/UsersPage"));
const RolesPage = lazyPage(() => import("./pages/admin/RolesPage"));
const BranchesPage = lazyPage(() => import("./pages/admin/BranchesPage"));
const AuditLogPage = lazyPage(() => import("./pages/admin/AuditLogPage"));
const BackupPage = lazyPage(() => import("./pages/admin/BackupPage"));
const VatImportPage = lazyPage(() => import("./pages/admin/VatImportPage"));
const GeneralSettingsPage = lazyPage(() => import("./pages/admin/GeneralSettingsPage"));
const DocumentNumberingPage = lazyPage(() => import("./pages/admin/DocumentNumberingPage"));
const DiagnosticsPage = lazyPage(() => import("./pages/admin/DiagnosticsPage"));
const InChunkSettingsPage = lazyPage(() => import("./pages/admin/InChunkSettingsPage"));
const GithubDeploySyncPage = lazyPage(() => import("./pages/admin/GithubDeploySyncPage"));

const ChartOfAccounts = lazyPage(() => import("./pages/accounts/ChartOfAccounts"));
const AccountingVouchers = lazyPage(() => import("./pages/accounts/AccountingVouchers"));
const MoneyReceiptsPage = lazyPage(() => import("./pages/accounts/MoneyReceiptsPage"));
const BulkVoucherEntryPage = lazyPage(() => import("./pages/accounts/BulkVoucherEntryPage"));
const DeletedVouchersPage = lazyPage(() => import("./pages/accounts/DeletedVouchersPage"));
const AccountingAuditLogPage = lazyPage(() => import("./pages/accounts/AccountingAuditLogPage"));
const TreasuryInformationPage = lazyPage(() => import("./pages/accounts/TreasuryInformationPage"));
const PermissionMatrixPage = lazyPage(() => import("./pages/admin/PermissionMatrixPage"));

const SalesPage = lazyPage(() => import("./pages/sales/SalesPage"));
const SalesInvoiceDetailPage = lazyPage(() => import("./pages/sales/SalesInvoiceDetailPage"));

// Purchase module (Phase 1 Foundation)
const PurchaseDashboardPage = lazyPage(() => import("./pages/purchase/PurchaseDashboardPage"));
const PurchaseSuppliersPage = lazyPage(() => import("./pages/purchase/SuppliersPage"));
const PurchaseTypesPage = lazyPage(() => import("./pages/purchase/PurchaseTypesPage"));
const PurchaseSettingsPage = lazyPage(() => import("./pages/purchase/PurchaseSettingsPage"));
const PurchaseApprovalMatrixPage = lazyPage(() => import("./pages/purchase/ApprovalMatrixPage"));
const PurchaseCoaMappingPage = lazyPage(() => import("./pages/purchase/CoaMappingPage"));
const PurchaseAuditLogPage = lazyPage(() => import("./pages/purchase/AuditLogPage"));
// Purchase module (Phase 2 PR & PO)
const PurchaseRequisitionsPage = lazyPage(() => import("./pages/purchase/RequisitionsPage"));
const PurchaseRequisitionFormPage = lazyPage(() => import("./pages/purchase/RequisitionFormPage"));
const PurchaseRequisitionDetailPage = lazyPage(() => import("./pages/purchase/RequisitionDetailPage"));
const PurchaseOrdersV2Page = lazyPage(() => import("./pages/purchase/PurchaseOrdersPage"));
const PurchaseOrderV2FormPage = lazyPage(() => import("./pages/purchase/PurchaseOrderFormPage"));
const PurchaseOrderV2DetailPage = lazyPage(() => import("./pages/purchase/PurchaseOrderDetailPage"));
const GrnsPage = lazyPage(() => import("./pages/purchase/GrnsPage"));
const GrnFormPage = lazyPage(() => import("./pages/purchase/GrnFormPage"));
const GrnDetailPage = lazyPage(() => import("./pages/purchase/GrnDetailPage"));
// Purchase module (Phase 4 Billing / Payments / LC)
const SupplierBillsPage = lazyPage(() => import("./pages/purchase/SupplierBillsPage"));
const SupplierBillFormPage = lazyPage(() => import("./pages/purchase/SupplierBillFormPage"));
const SupplierBillDetailPage = lazyPage(() => import("./pages/purchase/SupplierBillDetailPage"));
const SupplierPaymentsPage = lazyPage(() => import("./pages/purchase/SupplierPaymentsPage"));
const SupplierPaymentFormPage = lazyPage(() => import("./pages/purchase/SupplierPaymentFormPage"));
const SupplierPaymentDetailPage = lazyPage(() => import("./pages/purchase/SupplierPaymentDetailPage"));
const LcsPage = lazyPage(() => import("./pages/purchase/LcsPage"));
const LcFormPage = lazyPage(() => import("./pages/purchase/LcFormPage"));
const LcDetailPage = lazyPage(() => import("./pages/purchase/LcDetailPage"));
// Purchase module (Phase 5 Returns & Reports)
const PurchaseReturnsPage = lazyPage(() => import("./pages/purchase/PurchaseReturnsPage"));
const PurchaseReturnFormPage = lazyPage(() => import("./pages/purchase/PurchaseReturnFormPage"));
const PurchaseReturnDetailPage = lazyPage(() => import("./pages/purchase/PurchaseReturnDetailPage"));
const PurchaseReportsPage = lazyPage(() => import("./pages/purchase/PurchaseReportsPage"));
const InventoryPage = lazyPage(() => import("./pages/inventory/InventoryPage"));
const UnitsPage = lazyPage(() => import("./pages/inventory/UnitsPage"));
const ItemCategoriesPage = lazyPage(() => import("./pages/inventory/ItemCategoriesPage"));
const ItemMasterPage = lazyPage(() => import("./pages/inventory/ItemMasterPage"));
const StockGroupsPage = lazyPage(() => import("./pages/inventory/StockGroupsPage"));
const ChartOfInventoryPage = lazyPage(() => import("./pages/inventory/ChartOfInventoryPage"));
const WarehousesPage = lazyPage(() => import("./pages/inventory/WarehousesPage"));
const StockTransferPage = lazyPage(() => import("./pages/inventory/StockTransferPage"));
const FinancialReports = lazyPage(() => import("./pages/reports/FinancialReports"));
const StockLedger = lazyPage(() => import("./pages/reports/StockLedger"));
const CustomersPage = lazyPage(() => import("./pages/CustomersPage"));
const CustomerProfilePage = lazyPage(() => import("./pages/CustomerProfilePage"));
const FinancialYearsPage = lazyPage(() => import("./pages/FinancialYearsPage"));
const ChangePasswordPage = lazyPage(() => import("./pages/ChangePasswordPage"));
const BankAccountsPage = lazyPage(() => import("./pages/bank/BankAccountsPage"));
const CashBookPage = lazyPage(() => import("./pages/bank/CashBookPage"));
const LowStockPage = lazyPage(() => import("./pages/reports/LowStockPage"));
const StockReportsPage = lazyPage(() => import("./pages/reports/StockReportsPage"));
const StockByGroupPage = lazyPage(() => import("./pages/reports/StockByGroupPage"));
const StockAdjustmentPage = lazyPage(() => import("./pages/inventory/StockAdjustmentPage"));
const NotFound = lazyPage(() => import("./pages/NotFound"));
const ResetPassword = lazyPage(() => import("./pages/ResetPassword"));
const ShortcutsPage = lazyPage(() => import("./pages/admin/ShortcutsPage"));
const BrandingPage = lazyPage(() => import("./pages/admin/BrandingPage"));
const SmsSettingsPage = lazyPage(() => import("./pages/admin/SmsSettingsPage"));
const MessagingPage = lazyPage(() => import("./pages/messaging/MessagingPage"));
// HRM Pages
const EmployeesPage = lazyPage(() => import("./pages/hrm/EmployeesPage"));
const EmployeeApprovalsPage = lazyPage(() => import("./pages/hrm/EmployeeApprovalsPage"));
const DepartmentsPage = lazyPage(() => import("./pages/hrm/DepartmentsPage"));
const DesignationsPage = lazyPage(() => import("./pages/hrm/DesignationsPage"));
const AttendancePage = lazyPage(() => import("./pages/hrm/AttendancePage"));
const LeavePage = lazyPage(() => import("./pages/hrm/LeavePage"));
const PayrollPage = lazyPage(() => import("./pages/hrm/PayrollPage"));
const DocumentsPage = lazyPage(() => import("./pages/hrm/DocumentsPage"));
const IdCardsPage = lazyPage(() => import("./pages/hrm/IdCardsPage"));
const HrReportsPage = lazyPage(() => import("./pages/hrm/HrReportsPage"));
const EmployeeVerifyPage = lazyPage(() => import("./pages/hrm/EmployeeVerifyPage"));
const MoneyReceiptVerifyPage = lazyPage(() => import("./pages/MoneyReceiptVerifyPage"));
const ShiftsPage = lazyPage(() => import("./pages/hrm/ShiftsPage"));
const BiometricImportPage = lazyPage(() => import("./pages/hrm/BiometricImportPage"));
const OvertimePage = lazyPage(() => import("./pages/hrm/OvertimePage"));
const FaceAttendancePage = lazyPage(() => import("./pages/hrm/FaceAttendancePage"));
const HrDashboardPage = lazyPage(() => import("./pages/hrm/HrDashboardPage"));
const EmployeeProfilePage = lazyPage(() => import("./pages/hrm/EmployeeProfilePage"));
const LoginActivityPage = lazyPage(() => import("./pages/hrm/LoginActivityPage"));
const FundsPage = lazyPage(() => import("./pages/hrm/FundsPage"));
const SectionsPage = lazyPage(() => import("./pages/hrm/SectionsPage"));


// Manufacturing Pages
const BOMPage = lazyPage(() => import("./pages/manufacturing/BOMPage"));
const ProductionPage = lazyPage(() => import("./pages/manufacturing/ProductionPage"));
const ManufacturingReports = lazyPage(() => import("./pages/manufacturing/ManufacturingReports"));
const RawMaterialsPage = lazyPage(() => import("./pages/manufacturing/RawMaterialsPage"));

// Inventory - Stock Ledger
const StockLedgerPage = lazyPage(() => import("./pages/inventory/StockLedgerPage"));

// Employee Portal Pages
const MyDashboardPage = lazyPage(() => import("./pages/portal/MyDashboardPage"));
const MyProfilePage = lazyPage(() => import("./pages/portal/MyProfilePage"));
const MyAttendancePage = lazyPage(() => import("./pages/portal/MyAttendancePage"));
const MyLeavePage = lazyPage(() => import("./pages/portal/MyLeavePage"));
const MyPayslipsPage = lazyPage(() => import("./pages/portal/MyPayslipsPage"));
const MyDocumentsPage = lazyPage(() => import("./pages/portal/MyDocumentsPage"));

// Accounting Report Pages
const TrialBalanceReport = lazyPage(() => import("./pages/reports/accounting/TrialBalanceReport"));
const ProfitLossReport = lazyPage(() => import("./pages/reports/accounting/ProfitLossReport"));
const BalanceSheetReport = lazyPage(() => import("./pages/reports/accounting/BalanceSheetReport"));
const AccountLedgerReport = lazyPage(() => import("./pages/reports/accounting/AccountLedgerReport"));
const PartyLedgerReport = lazyPage(() => import("./pages/reports/accounting/PartyLedgerReport"));
const CashBookReport = lazyPage(() => import("./pages/reports/accounting/CashBookReport"));
const BankBookReport = lazyPage(() => import("./pages/reports/accounting/BankBookReport"));
const BankReconciliationReport = lazyPage(() => import("./pages/reports/accounting/BankReconciliationReport"));
const AccountsReceivableReport = lazyPage(() => import("./pages/reports/accounting/AccountsReceivableReport"));
const ARAgingReport = lazyPage(() => import("./pages/reports/accounting/AgingReports").then((m) => ({ default: m.ARAgingReport })));
const IncomeAnalysisReport = lazyPage(() => import("./pages/reports/accounting/AnalysisReports").then((m) => ({ default: m.IncomeAnalysisReport })));
const FinancialSummaryDashboard = lazyPage(() => import("./pages/reports/accounting/FinancialSummaryDashboard"));
const ChartOfAccountsVertical = lazyPage(() => import("./pages/reports/accounting/ChartOfAccountsVertical"));
const IFRSFinancialStatements = lazyPage(() => import("./pages/reports/accounting/IFRSFinancialStatements"));
const IFRSMappingPage = lazyPage(() => import("./pages/admin/IFRSMappingPage"));
const CustomerStatementPage = lazyPage(() => import("./pages/reports/CustomerStatementPage"));
const SalesReport = lazyPage(() => import("./pages/reports/SalesReport"));

// Sales (BD VAT)
const PurchaseOrdersPage = lazyPage(() => import("./pages/sales-workflow/PurchaseOrdersPage"));
const PurchaseOrderFormPage = lazyPage(() => import("./pages/sales-workflow/PurchaseOrderFormPage"));
const PurchaseOrderDetailPage = lazyPage(() => import("./pages/sales-workflow/PurchaseOrderDetailPage"));
const VatChallansPage = lazyPage(() => import("./pages/sales-workflow/VatChallansPage"));
const VatChallanFormPage = lazyPage(() => import("./pages/sales-workflow/VatChallanFormPage"));
const VatChallanDetailPage = lazyPage(() => import("./pages/sales-workflow/VatChallanDetailPage"));
const Mushak63PreviewPage = lazyPage(() => import("./pages/sales-workflow/Mushak63PreviewPage"));
const DeliveryChallansPage = lazyPage(() => import("./pages/sales-workflow/DeliveryChallansPage"));
const CustomerReceivePage = lazyPage(() => import("./pages/sales-workflow/CustomerReceivePage"));
const HoReceivePage = lazyPage(() => import("./pages/sales-workflow/HoReceivePage"));
const InvoiceQueuePage = lazyPage(() => import("./pages/sales-workflow/InvoiceQueuePage"));
const InvoicesPage = lazyPage(() => import("./pages/sales-workflow/InvoicesPage"));
const InvoiceDetailPage = lazyPage(() => import("./pages/sales-workflow/InvoiceDetailPage"));
const TdsRegisterPage = lazyPage(() => import("./pages/sales-workflow/TdsRegisterPage"));
const SalesWorkflowReportsIndex = lazyPage(() => import("./pages/sales-workflow/reports/SalesWorkflowReportsIndex"));
const PoVsVatChallanReport = lazyPage(() => import("./pages/sales-workflow/reports/PoVsVatChallanReport"));
const PendingPoReport = lazyPage(() => import("./pages/sales-workflow/reports/PendingPoReport"));
const ChallanStatusReport = lazyPage(() => import("./pages/sales-workflow/reports/ChallanStatusReport"));
const VatRegisterReport = lazyPage(() => import("./pages/sales-workflow/reports/VatRegisterReport"));
const InvoiceRegisterReport = lazyPage(() => import("./pages/sales-workflow/reports/InvoiceRegisterReport"));
const InvoicePendingReport = lazyPage(() => import("./pages/sales-workflow/reports/InvoicePendingReport"));
const CollectionReport = lazyPage(() => import("./pages/sales-workflow/reports/CollectionReport"));
const ArAgingReport = lazyPage(() => import("./pages/sales-workflow/reports/ArAgingReport"));
const Mushak91Page = lazyPage(() => import("./pages/sales-workflow/reports/Mushak91Page"));


const queryClient = new QueryClient();

/** Helper: wraps a page with permission check */
const P = ({ perm, children }: { perm: string; children: React.ReactNode }) => (
  <ProtectedRoute requiredPermission={perm}>{children}</ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ThemeProvider>
        <AuthProvider>
          <BranchProvider>
          <CurrencyProvider>
          <ModuleProvider>
          <BrandingProvider>
          <LicenseProvider>
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/install" element={<InstallPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register-employee" element={<PublicEmployeeRegistration />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/employee/verify" element={<EmployeeVerifyPage />} />
              <Route path="/employee/verify/:code" element={<EmployeeVerifyPage />} />
              <Route path="/verify/:code" element={<EmployeeVerifyPage />} />
              <Route path="/verify/money-receipt/:code" element={<MoneyReceiptVerifyPage />} />
              <Route path="/license-verification" element={<LicenseVerificationPage />} />



              <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                {/* Dashboard — all authenticated users */}
                <Route path="/" element={<Dashboard />} />
                <Route path="/vouchers" element={<VouchersPage />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/change-password" element={<ChangePasswordPage />} />
                <Route path="/messaging" element={<P perm="messaging.view"><MessagingPage /></P>} />

                {/* ─── Accounts ─────────────────────────────────── */}
                <Route path="/accounts/chart" element={<P perm="accounts.view"><ChartOfAccounts /></P>} />
                <Route path="/accounts/vouchers" element={<AccountingVouchers />} />
                <Route path="/accounts/money-receipts" element={<MoneyReceiptsPage />} />
                <Route path="/accounts/vouchers/bulk-entry" element={<BulkVoucherEntryPage />} />
                <Route path="/accounts/vouchers/trash" element={<DeletedVouchersPage />} />
                <Route path="/accounts/audit-log" element={<AccountingAuditLogPage />} />
                <Route path="/accounts/treasury" element={<P perm="accounts.view"><TreasuryInformationPage /></P>} />
                <Route path="/admin/permission-matrix" element={<P perm="roles.view"><PermissionMatrixPage /></P>} />

                {/* ─── Sales ────────────────────────────────────── */}
                <Route path="/sales" element={<P perm="sales.view"><SalesPage /></P>} />
                <Route path="/sales/invoices/:id" element={<P perm="sales.view"><SalesInvoiceDetailPage /></P>} />
                <Route path="/sales/returns" element={<P perm="sales.view"><SalesPage /></P>} />
                <Route path="/customers" element={<P perm="customers.view,sales.view"><CustomersPage /></P>} />
                <Route path="/customers/:id" element={<P perm="customers.view,sales.view"><CustomerProfilePage /></P>} />

                {/* ─── Purchase (Phase 1 Foundation) ─────────────── */}
                <Route path="/purchase" element={<PurchaseDashboardPage />} />
                <Route path="/purchase/suppliers" element={<PurchaseSuppliersPage />} />
                <Route path="/purchase/types" element={<PurchaseTypesPage />} />
                <Route path="/purchase/settings" element={<PurchaseSettingsPage />} />
                <Route path="/purchase/approval-matrix" element={<PurchaseApprovalMatrixPage />} />
                <Route path="/purchase/coa-mapping" element={<PurchaseCoaMappingPage />} />
                <Route path="/purchase/audit-log" element={<PurchaseAuditLogPage />} />
                {/* ─── Purchase (Phase 2 PR & PO) ────────────────── */}
                <Route path="/purchase/requisitions" element={<PurchaseRequisitionsPage />} />
                <Route path="/purchase/requisitions/new" element={<PurchaseRequisitionFormPage />} />
                <Route path="/purchase/requisitions/:id" element={<PurchaseRequisitionDetailPage />} />
                <Route path="/purchase/requisitions/:id/edit" element={<PurchaseRequisitionFormPage />} />
                <Route path="/purchase/orders" element={<PurchaseOrdersV2Page />} />
                <Route path="/purchase/orders/new" element={<PurchaseOrderV2FormPage />} />
                <Route path="/purchase/orders/:id" element={<PurchaseOrderV2DetailPage />} />
                <Route path="/purchase/orders/:id/edit" element={<PurchaseOrderV2FormPage />} />
                <Route path="/purchase/grns" element={<GrnsPage />} />
                <Route path="/purchase/grns/new" element={<GrnFormPage />} />
                <Route path="/purchase/grns/:id" element={<GrnDetailPage />} />
                <Route path="/purchase/grns/:id/edit" element={<GrnFormPage />} />
                {/* ─── Purchase (Phase 4 Billing / Payments / LC) ─── */}
                <Route path="/purchase/bills" element={<SupplierBillsPage />} />
                <Route path="/purchase/bills/new" element={<SupplierBillFormPage />} />
                <Route path="/purchase/bills/:id" element={<SupplierBillDetailPage />} />
                <Route path="/purchase/bills/:id/edit" element={<SupplierBillFormPage />} />
                <Route path="/purchase/payments" element={<SupplierPaymentsPage />} />
                <Route path="/purchase/payments/new" element={<SupplierPaymentFormPage />} />
                <Route path="/purchase/payments/:id" element={<SupplierPaymentDetailPage />} />
                <Route path="/purchase/lc" element={<LcsPage />} />
                <Route path="/purchase/lc/new" element={<LcFormPage />} />
                <Route path="/purchase/lc/:id" element={<LcDetailPage />} />
                <Route path="/purchase/lc/:id/edit" element={<LcFormPage />} />
                {/* ─── Purchase (Phase 5 Returns & Reports) ─── */}
                <Route path="/purchase/returns" element={<PurchaseReturnsPage />} />
                <Route path="/purchase/returns/new" element={<PurchaseReturnFormPage />} />
                <Route path="/purchase/returns/:id" element={<PurchaseReturnDetailPage />} />
                <Route path="/purchase/returns/:id/edit" element={<PurchaseReturnFormPage />} />
                <Route path="/purchase/reports" element={<PurchaseReportsPage />} />




                {/* ─── Inventory ────────────────────────────────── */}
                <Route path="/inventory" element={<P perm="inventory.view"><InventoryPage /></P>} />
                <Route path="/inventory/items" element={<P perm="inventory.view"><ItemMasterPage /></P>} />
                <Route path="/inventory/categories" element={<P perm="inventory.view"><ItemCategoriesPage /></P>} />
                <Route path="/inventory/stock-groups" element={<P perm="inventory.view"><StockGroupsPage /></P>} />
                <Route path="/inventory/chart" element={<P perm="inventory.view"><ChartOfInventoryPage /></P>} />
                <Route path="/inventory/units" element={<P perm="inventory.view"><UnitsPage /></P>} />
                <Route path="/inventory/warehouses" element={<P perm="inventory.view"><WarehousesPage /></P>} />
                <Route path="/inventory/transfers" element={<P perm="inventory.view"><StockTransferPage /></P>} />
                <Route path="/inventory/adjustments" element={<P perm="inventory.view"><StockAdjustmentPage /></P>} />
                <Route path="/inventory/stock-ledger" element={<P perm="inventory.view"><StockLedgerPage /></P>} />
                <Route path="/products" element={<P perm="inventory.view"><ItemMasterPage /></P>} />


                {/* ─── Manufacturing ────────────────────────────── */}
                <Route path="/manufacturing/materials" element={<P perm="manufacturing.view"><RawMaterialsPage /></P>} />
                <Route path="/manufacturing/bom" element={<P perm="manufacturing.view"><BOMPage /></P>} />
                <Route path="/manufacturing/production" element={<P perm="manufacturing.view"><ProductionPage /></P>} />
                <Route path="/manufacturing/reports" element={<P perm="manufacturing.view"><ManufacturingReports /></P>} />

                {/* ─── Bank & Cash ──────────────────────────────── */}
                <Route path="/bank/accounts" element={<P perm="bank.view"><BankAccountsPage /></P>} />
                <Route path="/bank/cashbook" element={<P perm="bank.view"><CashBookPage /></P>} />

                {/* ─── HRM ──────────────────────────────────────── */}
                <Route path="/hrm/dashboard" element={<P perm="hrm.view"><HrDashboardPage /></P>} />
                <Route path="/hrm/employees" element={<P perm="hrm.view"><EmployeesPage /></P>} />
                <Route path="/hrm/employee-approvals" element={<P perm="hrm.edit"><EmployeeApprovalsPage /></P>} />
                <Route path="/hrm/employees/:id" element={<P perm="hrm.view"><EmployeeProfilePage /></P>} />
                <Route path="/hrm/departments" element={<P perm="hrm.view"><DepartmentsPage /></P>} />
                <Route path="/hrm/sections" element={<P perm="hrm.view"><SectionsPage /></P>} />

                <Route path="/hrm/designations" element={<P perm="hrm.view"><DesignationsPage /></P>} />
                <Route path="/hrm/shifts" element={<P perm="hrm.view"><ShiftsPage /></P>} />
                <Route path="/hrm/attendance" element={<P perm="hrm.view"><AttendancePage /></P>} />
                <Route path="/hrm/biometric" element={<P perm="hrm.view"><BiometricImportPage /></P>} />
                <Route path="/hrm/face-attendance" element={<P perm="hrm.view"><FaceAttendancePage /></P>} />
                <Route path="/hrm/overtime" element={<P perm="hrm.view"><OvertimePage /></P>} />
                <Route path="/hrm/leave" element={<P perm="hrm.view"><LeavePage /></P>} />
                <Route path="/hrm/payroll" element={<P perm="hrm.view"><PayrollPage /></P>} />
                <Route path="/hrm/funds" element={<P perm="hrm.view"><FundsPage /></P>} />
                <Route path="/hrm/documents" element={<P perm="hrm.view"><DocumentsPage /></P>} />
                <Route path="/hrm/id-cards" element={<P perm="hrm.view"><IdCardsPage /></P>} />
                <Route path="/hrm/reports" element={<P perm="hrm.view"><HrReportsPage /></P>} />
                <Route path="/hrm/login-activity" element={<P perm="hrm.view"><LoginActivityPage /></P>} />

                {/* ─── Employee Portal (own data — no module permission needed) ── */}
                <Route path="/portal/dashboard" element={<MyDashboardPage />} />
                <Route path="/portal/profile" element={<MyProfilePage />} />
                <Route path="/portal/attendance" element={<MyAttendancePage />} />
                <Route path="/portal/leave" element={<MyLeavePage />} />
                <Route path="/portal/payslips" element={<MyPayslipsPage />} />
                <Route path="/portal/documents" element={<MyDocumentsPage />} />

                {/* ─── Reports ──────────────────────────────────── */}
                <Route path="/reports/financial" element={<P perm="reports.view"><FinancialReports /></P>} />
                <Route path="/reports/financial-summary" element={<P perm="reports.view"><FinancialSummaryDashboard /></P>} />
                <Route path="/reports/trial-balance" element={<P perm="accounts.view"><TrialBalanceReport /></P>} />
                <Route path="/reports/chart-of-accounts-vertical" element={<P perm="accounts.view"><ChartOfAccountsVertical /></P>} />
                <Route path="/reports/ifrs-financial-statements" element={<P perm="accounts.view"><IFRSFinancialStatements /></P>} />
                <Route path="/admin/ifrs-mapping" element={<P perm="accounts.view"><IFRSMappingPage /></P>} />
                <Route path="/reports/profit-loss" element={<P perm="accounts.view"><ProfitLossReport /></P>} />
                <Route path="/reports/balance-sheet" element={<P perm="accounts.view"><BalanceSheetReport /></P>} />
                <Route path="/reports/account-ledger" element={<P perm="accounts.view"><AccountLedgerReport /></P>} />
                <Route path="/reports/party-ledger" element={<P perm="reports.view"><PartyLedgerReport /></P>} />
                <Route path="/reports/cash-book" element={<P perm="bank.view"><CashBookReport /></P>} />
                <Route path="/reports/bank-book" element={<P perm="bank.view"><BankBookReport /></P>} />
                <Route path="/reports/bank-reconciliation" element={<P perm="bank.view"><BankReconciliationReport /></P>} />
                <Route path="/reports/accounts-receivable" element={<P perm="sales.view"><AccountsReceivableReport /></P>} />
                <Route path="/reports/ar-aging" element={<P perm="sales.view"><ARAgingReport /></P>} />
                <Route path="/reports/income-analysis" element={<P perm="sales.view"><IncomeAnalysisReport /></P>} />
                <Route path="/reports/stock-ledger" element={<P perm="inventory.view"><StockLedger /></P>} />
                <Route path="/reports/stock-reports" element={<P perm="inventory.view"><StockReportsPage /></P>} />
                <Route path="/reports/stock-by-group" element={<P perm="inventory.view"><StockByGroupPage /></P>} />
                <Route path="/reports/low-stock" element={<P perm="inventory.view"><LowStockPage /></P>} />
                <Route path="/reports/customer-statement" element={<P perm="sales.view"><CustomerStatementPage /></P>} />
                <Route path="/reports/sales" element={<P perm="sales.view"><SalesReport /></P>} />

                {/* ─── Administration ──────────────────────────── */}
                <Route path="/admin/users" element={<P perm="users.view"><UsersPage /></P>} />
                <Route path="/admin/roles" element={<P perm="roles.view"><RolesPage /></P>} />
                <Route path="/admin/branches" element={<P perm="branches.view"><BranchesPage /></P>} />
                <Route path="/admin/financial-years" element={<P perm="financial_years.view"><FinancialYearsPage /></P>} />
                <Route path="/admin/audit-log" element={<P perm="audit_log.view"><AuditLogPage /></P>} />
                <Route path="/admin/backup" element={<P perm="backup.view"><BackupPage /></P>} />
                <Route path="/admin/vat-import" element={<P perm="backup.view"><VatImportPage /></P>} />
                <Route path="/admin/settings" element={<P perm="settings.view"><GeneralSettingsPage /></P>} />
                <Route path="/admin/numbering" element={<P perm="settings.view"><DocumentNumberingPage /></P>} />
                <Route path="/admin/shortcuts" element={<P perm="settings.view"><ShortcutsPage /></P>} />
                <Route path="/admin/branding" element={<P perm="settings.view"><BrandingPage /></P>} />
                <Route path="/admin/sms" element={<P perm="settings.view"><SmsSettingsPage /></P>} />
                <Route path="/admin/diagnostics" element={<DiagnosticsPage />} />
                <Route path="/admin/in-chunk" element={<P perm="settings.view"><InChunkSettingsPage /></P>} />
                <Route path="/admin/github-deploy" element={<P perm="settings.view"><GithubDeploySyncPage /></P>} />
                

                {/* ─── Sales (BD VAT) ─────────────────── */}
                <Route path="/sales-workflow/po" element={<P perm="sales.view"><PurchaseOrdersPage /></P>} />
                <Route path="/sales-workflow/po/new" element={<P perm="sales.create"><PurchaseOrderFormPage /></P>} />
                <Route path="/sales-workflow/po/:id/edit" element={<P perm="sales.edit"><PurchaseOrderFormPage /></P>} />
                <Route path="/sales-workflow/po/:id" element={<P perm="sales.view"><PurchaseOrderDetailPage /></P>} />
                <Route path="/sales-workflow/vat-challan" element={<P perm="sales.view"><VatChallansPage /></P>} />
                <Route path="/sales-workflow/vat-challan/new" element={<P perm="sales.create"><VatChallanFormPage /></P>} />
                <Route path="/sales-workflow/vat-challan/:id/edit" element={<P perm="sales.edit"><VatChallanFormPage /></P>} />
                <Route path="/sales-workflow/vat-challan/preview" element={<P perm="sales.view"><Mushak63PreviewPage /></P>} />
                <Route path="/sales-workflow/vat-challan/:id" element={<P perm="sales.view"><VatChallanDetailPage /></P>} />
                <Route path="/sales-workflow/delivery-challan" element={<P perm="sales.view"><DeliveryChallansPage /></P>} />
                <Route path="/sales-workflow/customer-receive" element={<P perm="sales.edit"><CustomerReceivePage /></P>} />
                <Route path="/sales-workflow/ho-receive" element={<P perm="sales.edit"><HoReceivePage /></P>} />
                <Route path="/sales-workflow/invoice-queue" element={<P perm="sales.create"><InvoiceQueuePage /></P>} />
                <Route path="/sales-workflow/invoices" element={<P perm="sales.view"><InvoicesPage /></P>} />
                <Route path="/sales-workflow/invoice/:id" element={<P perm="sales.view"><InvoiceDetailPage /></P>} />
                <Route path="/sales-workflow/tds" element={<P perm="sales.view"><TdsRegisterPage /></P>} />
                <Route path="/sales-workflow/reports" element={<P perm="reports.view"><SalesWorkflowReportsIndex /></P>} />
                <Route path="/sales-workflow/reports/po-vs-vat-challan" element={<P perm="reports.view"><PoVsVatChallanReport /></P>} />
                <Route path="/sales-workflow/reports/pending-po" element={<P perm="reports.view"><PendingPoReport /></P>} />
                <Route path="/sales-workflow/reports/challan-status" element={<P perm="reports.view"><ChallanStatusReport /></P>} />
                <Route path="/sales-workflow/reports/vat-register" element={<P perm="reports.view"><VatRegisterReport /></P>} />
                <Route path="/sales-workflow/reports/invoice-register" element={<P perm="reports.view"><InvoiceRegisterReport /></P>} />
                <Route path="/sales-workflow/reports/invoice-pending" element={<P perm="reports.view"><InvoicePendingReport /></P>} />
                <Route path="/sales-workflow/reports/collection" element={<P perm="reports.view"><CollectionReport /></P>} />
                <Route path="/sales-workflow/reports/aging" element={<P perm="reports.view"><ArAgingReport /></P>} />
                <Route path="/sales-workflow/reports/mushak-9-1" element={<P perm="reports.view"><Mushak91Page /></P>} />

              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
          </LicenseProvider>
          </BrandingProvider>
          </ModuleProvider>
          </CurrencyProvider>
          </BranchProvider>
        </AuthProvider>
      </ThemeProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;