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
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import Login from "./pages/Login";
import PublicEmployeeRegistration from "./pages/PublicEmployeeRegistration";
import InstallPage from "./pages/InstallPage";
import Dashboard from "./pages/Dashboard";
import VouchersPage from "./pages/VouchersPage";
import Profile from "./pages/Profile";
import UsersPage from "./pages/admin/UsersPage";
import RolesPage from "./pages/admin/RolesPage";
import BranchesPage from "./pages/admin/BranchesPage";
import AuditLogPage from "./pages/admin/AuditLogPage";
import BackupPage from "./pages/admin/BackupPage";
import GeneralSettingsPage from "./pages/admin/GeneralSettingsPage";
import DocumentNumberingPage from "./pages/admin/DocumentNumberingPage";
import DiagnosticsPage from "./pages/admin/DiagnosticsPage";
import InChunkSettingsPage from "./pages/admin/InChunkSettingsPage";
import GithubDeploySyncPage from "./pages/admin/GithubDeploySyncPage";

import ChartOfAccounts from "./pages/accounts/ChartOfAccounts";
import AccountingVouchers from "./pages/accounts/AccountingVouchers";
import TreasuryInformationPage from "./pages/accounts/TreasuryInformationPage";
import VoucherApprovalDashboard from "./pages/accounts/VoucherApprovalDashboard";
import PermissionMatrixPage from "./pages/admin/PermissionMatrixPage";

import SalesPage from "./pages/sales/SalesPage";
import SalesInvoiceDetailPage from "./pages/sales/SalesInvoiceDetailPage";

// Purchase module (Phase 1 Foundation)
import PurchaseDashboardPage from "./pages/purchase/PurchaseDashboardPage";
import PurchaseSuppliersPage from "./pages/purchase/SuppliersPage";
import PurchaseTypesPage from "./pages/purchase/PurchaseTypesPage";
import PurchaseSettingsPage from "./pages/purchase/PurchaseSettingsPage";
import PurchaseApprovalMatrixPage from "./pages/purchase/ApprovalMatrixPage";
import PurchaseCoaMappingPage from "./pages/purchase/CoaMappingPage";
import PurchaseAuditLogPage from "./pages/purchase/AuditLogPage";
// Purchase module (Phase 2 PR & PO)
import PurchaseRequisitionsPage from "./pages/purchase/RequisitionsPage";
import PurchaseRequisitionFormPage from "./pages/purchase/RequisitionFormPage";
import PurchaseRequisitionDetailPage from "./pages/purchase/RequisitionDetailPage";
import PurchaseOrdersV2Page from "./pages/purchase/PurchaseOrdersPage";
import PurchaseOrderV2FormPage from "./pages/purchase/PurchaseOrderFormPage";
import PurchaseOrderV2DetailPage from "./pages/purchase/PurchaseOrderDetailPage";
import GrnsPage from "./pages/purchase/GrnsPage";
import GrnFormPage from "./pages/purchase/GrnFormPage";
import GrnDetailPage from "./pages/purchase/GrnDetailPage";
// Purchase module (Phase 4 Billing / Payments / LC)
import SupplierBillsPage from "./pages/purchase/SupplierBillsPage";
import SupplierBillFormPage from "./pages/purchase/SupplierBillFormPage";
import SupplierBillDetailPage from "./pages/purchase/SupplierBillDetailPage";
import SupplierPaymentsPage from "./pages/purchase/SupplierPaymentsPage";
import SupplierPaymentFormPage from "./pages/purchase/SupplierPaymentFormPage";
import SupplierPaymentDetailPage from "./pages/purchase/SupplierPaymentDetailPage";
import LcsPage from "./pages/purchase/LcsPage";
import LcFormPage from "./pages/purchase/LcFormPage";
import LcDetailPage from "./pages/purchase/LcDetailPage";
// Purchase module (Phase 5 Returns & Reports)
import PurchaseReturnsPage from "./pages/purchase/PurchaseReturnsPage";
import PurchaseReturnFormPage from "./pages/purchase/PurchaseReturnFormPage";
import PurchaseReturnDetailPage from "./pages/purchase/PurchaseReturnDetailPage";
import PurchaseReportsPage from "./pages/purchase/PurchaseReportsPage";
import InventoryPage from "./pages/inventory/InventoryPage";
import UnitsPage from "./pages/inventory/UnitsPage";
import ItemCategoriesPage from "./pages/inventory/ItemCategoriesPage";
import ItemMasterPage from "./pages/inventory/ItemMasterPage";
import StockGroupsPage from "./pages/inventory/StockGroupsPage";
import ChartOfInventoryPage from "./pages/inventory/ChartOfInventoryPage";
import WarehousesPage from "./pages/inventory/WarehousesPage";
import StockTransferPage from "./pages/inventory/StockTransferPage";
import FinancialReports from "./pages/reports/FinancialReports";
import StockLedger from "./pages/reports/StockLedger";
import CustomersPage from "./pages/CustomersPage";
import CustomerProfilePage from "./pages/CustomerProfilePage";
import FinancialYearsPage from "./pages/FinancialYearsPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import BankAccountsPage from "./pages/bank/BankAccountsPage";
import CashBookPage from "./pages/bank/CashBookPage";
import LowStockPage from "./pages/reports/LowStockPage";
import StockReportsPage from "./pages/reports/StockReportsPage";
import StockByGroupPage from "./pages/reports/StockByGroupPage";
import StockAdjustmentPage from "./pages/inventory/StockAdjustmentPage";
import NotFound from "./pages/NotFound";
import ResetPassword from "./pages/ResetPassword";
import ShortcutsPage from "./pages/admin/ShortcutsPage";
import BrandingPage from "./pages/admin/BrandingPage";
import SmsSettingsPage from "./pages/admin/SmsSettingsPage";
import MessagingPage from "./pages/messaging/MessagingPage";
// HRM Pages
import EmployeesPage from "./pages/hrm/EmployeesPage";
import EmployeeApprovalsPage from "./pages/hrm/EmployeeApprovalsPage";
import DepartmentsPage from "./pages/hrm/DepartmentsPage";
import DesignationsPage from "./pages/hrm/DesignationsPage";
import AttendancePage from "./pages/hrm/AttendancePage";
import LeavePage from "./pages/hrm/LeavePage";
import PayrollPage from "./pages/hrm/PayrollPage";
import DocumentsPage from "./pages/hrm/DocumentsPage";
import IdCardsPage from "./pages/hrm/IdCardsPage";
import HrReportsPage from "./pages/hrm/HrReportsPage";
import EmployeeVerifyPage from "./pages/hrm/EmployeeVerifyPage";
import ShiftsPage from "./pages/hrm/ShiftsPage";
import BiometricImportPage from "./pages/hrm/BiometricImportPage";
import OvertimePage from "./pages/hrm/OvertimePage";
import FaceAttendancePage from "./pages/hrm/FaceAttendancePage";
import HrDashboardPage from "./pages/hrm/HrDashboardPage";
import EmployeeProfilePage from "./pages/hrm/EmployeeProfilePage";
import LoginActivityPage from "./pages/hrm/LoginActivityPage";
import FundsPage from "./pages/hrm/FundsPage";
import SectionsPage from "./pages/hrm/SectionsPage";


// Manufacturing Pages
import BOMPage from "./pages/manufacturing/BOMPage";
import ProductionPage from "./pages/manufacturing/ProductionPage";
import ManufacturingReports from "./pages/manufacturing/ManufacturingReports";
import RawMaterialsPage from "./pages/manufacturing/RawMaterialsPage";

// Inventory - Stock Ledger
import StockLedgerPage from "./pages/inventory/StockLedgerPage";

// Employee Portal Pages
import MyDashboardPage from "./pages/portal/MyDashboardPage";
import MyProfilePage from "./pages/portal/MyProfilePage";
import MyAttendancePage from "./pages/portal/MyAttendancePage";
import MyLeavePage from "./pages/portal/MyLeavePage";
import MyPayslipsPage from "./pages/portal/MyPayslipsPage";
import MyDocumentsPage from "./pages/portal/MyDocumentsPage";

// Accounting Report Pages
import TrialBalanceReport from "./pages/reports/accounting/TrialBalanceReport";
import ProfitLossReport from "./pages/reports/accounting/ProfitLossReport";
import BalanceSheetReport from "./pages/reports/accounting/BalanceSheetReport";
import GeneralLedgerReport from "./pages/reports/accounting/GeneralLedgerReport";
import AccountLedgerReport from "./pages/reports/accounting/AccountLedgerReport";
import PartyLedgerReport from "./pages/reports/accounting/PartyLedgerReport";
import CashBookReport from "./pages/reports/accounting/CashBookReport";
import BankBookReport from "./pages/reports/accounting/BankBookReport";
import BankReconciliationReport from "./pages/reports/accounting/BankReconciliationReport";
import { JournalVoucherReport, PaymentVoucherReport, ReceiptVoucherReport, ContraVoucherReport } from "./pages/reports/accounting/VoucherReports";
import AccountsReceivableReport from "./pages/reports/accounting/AccountsReceivableReport";
import { ARAgingReport } from "./pages/reports/accounting/AgingReports";
import { IncomeAnalysisReport } from "./pages/reports/accounting/AnalysisReports";
import FinancialSummaryDashboard from "./pages/reports/accounting/FinancialSummaryDashboard";
import ChartOfAccountsVertical from "./pages/reports/accounting/ChartOfAccountsVertical";
import IFRSFinancialStatements from "./pages/reports/accounting/IFRSFinancialStatements";
import IFRSMappingPage from "./pages/admin/IFRSMappingPage";
import CustomerStatementPage from "./pages/reports/CustomerStatementPage";
import SalesReport from "./pages/reports/SalesReport";

// Sales (BD VAT)
import PurchaseOrdersPage from "./pages/sales-workflow/PurchaseOrdersPage";
import PurchaseOrderFormPage from "./pages/sales-workflow/PurchaseOrderFormPage";
import PurchaseOrderDetailPage from "./pages/sales-workflow/PurchaseOrderDetailPage";
import VatChallansPage from "./pages/sales-workflow/VatChallansPage";
import VatChallanFormPage from "./pages/sales-workflow/VatChallanFormPage";
import VatChallanDetailPage from "./pages/sales-workflow/VatChallanDetailPage";
import Mushak63PreviewPage from "./pages/sales-workflow/Mushak63PreviewPage";
import DeliveryChallansPage from "./pages/sales-workflow/DeliveryChallansPage";
import CustomerReceivePage from "./pages/sales-workflow/CustomerReceivePage";
import HoReceivePage from "./pages/sales-workflow/HoReceivePage";
import InvoiceQueuePage from "./pages/sales-workflow/InvoiceQueuePage";
import InvoicesPage from "./pages/sales-workflow/InvoicesPage";
import InvoiceDetailPage from "./pages/sales-workflow/InvoiceDetailPage";
import TdsRegisterPage from "./pages/sales-workflow/TdsRegisterPage";
import SalesWorkflowReportsIndex from "./pages/sales-workflow/reports/SalesWorkflowReportsIndex";
import PoVsVatChallanReport from "./pages/sales-workflow/reports/PoVsVatChallanReport";
import PendingPoReport from "./pages/sales-workflow/reports/PendingPoReport";
import ChallanStatusReport from "./pages/sales-workflow/reports/ChallanStatusReport";
import VatRegisterReport from "./pages/sales-workflow/reports/VatRegisterReport";
import InvoiceRegisterReport from "./pages/sales-workflow/reports/InvoiceRegisterReport";
import InvoicePendingReport from "./pages/sales-workflow/reports/InvoicePendingReport";
import CollectionReport from "./pages/sales-workflow/reports/CollectionReport";
import ArAgingReport from "./pages/sales-workflow/reports/ArAgingReport";
import Mushak91Page from "./pages/sales-workflow/reports/Mushak91Page";


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
          <BrowserRouter>
            <Routes>
              <Route path="/install" element={<InstallPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register-employee" element={<PublicEmployeeRegistration />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/employee/verify" element={<EmployeeVerifyPage />} />
              <Route path="/employee/verify/:code" element={<EmployeeVerifyPage />} />
              <Route path="/verify/:code" element={<EmployeeVerifyPage />} />



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
                <Route path="/accounts/approvals" element={<P perm="accounts.view"><VoucherApprovalDashboard /></P>} />
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
                <Route path="/reports/general-ledger" element={<P perm="accounts.view"><GeneralLedgerReport /></P>} />
                <Route path="/reports/account-ledger" element={<P perm="accounts.view"><AccountLedgerReport /></P>} />
                <Route path="/reports/party-ledger" element={<P perm="reports.view"><PartyLedgerReport /></P>} />
                <Route path="/reports/cash-book" element={<P perm="bank.view"><CashBookReport /></P>} />
                <Route path="/reports/bank-book" element={<P perm="bank.view"><BankBookReport /></P>} />
                <Route path="/reports/bank-reconciliation" element={<P perm="bank.view"><BankReconciliationReport /></P>} />
                <Route path="/reports/journal-vouchers" element={<P perm="journal.view"><JournalVoucherReport /></P>} />
                <Route path="/reports/payment-vouchers" element={<P perm="payment.view"><PaymentVoucherReport /></P>} />
                <Route path="/reports/receipt-vouchers" element={<P perm="receipt.view"><ReceiptVoucherReport /></P>} />
                <Route path="/reports/contra-vouchers" element={<P perm="contra.view"><ContraVoucherReport /></P>} />
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
          </BrowserRouter>
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