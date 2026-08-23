import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableAccountSelect } from "@/components/accounts/SearchableAccountSelect";
import { Search, Printer, Download, FileSpreadsheet } from "lucide-react";

import { DateInput } from "@/components/ui/date-input";
interface Branch {
  id: string;
  name: string;
}

interface Account {
  id: string;
  account_name: string;
  account_code: string;
  account_type: string;
}

interface ReportFiltersProps {
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  branches?: Branch[];
  selectedBranch?: string;
  onBranchChange?: (v: string) => void;
  accounts?: Account[];
  selectedAccount?: string;
  onAccountChange?: (v: string) => void;
  multipleAccounts?: boolean;
  selectedAccounts?: string[];
  onSelectedAccountsChange?: (v: string[]) => void;
  onSearch: () => void;
  onPrint: () => void;
  onExportExcel: () => void;
  onExportPDF: () => void;
  loading?: boolean;
  searchText?: string;
  onSearchTextChange?: (v: string) => void;
  children?: React.ReactNode;
}

export const ReportFilters = ({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  branches,
  selectedBranch,
  onBranchChange,
  accounts,
  selectedAccount,
  onAccountChange,
  onSearch,
  onPrint,
  onExportExcel,
  onExportPDF,
  loading,
  searchText,
  onSearchTextChange,
  children,
}: ReportFiltersProps) => {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">From</Label>
          <DateInput value={dateFrom} onChange={(v) => onDateFromChange(v)} className="w-36 h-9 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">To</Label>
          <DateInput value={dateTo} onChange={(v) => onDateToChange(v)} className="w-36 h-9 text-sm" />
        </div>
        {branches && branches.length > 0 && onBranchChange && (
          <div className="space-y-1.5">
            <Label className="text-xs">Branch</Label>
            <Select value={selectedBranch || "all"} onValueChange={onBranchChange}>
              <SelectTrigger className="w-44 h-9 text-sm"><SelectValue placeholder="All Branches" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Branches</SelectItem>
                {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {accounts && onAccountChange && (
          <div className="space-y-1.5">
            <Label className="text-xs">Account</Label>
            <div className="w-64">
              <SearchableAccountSelect
                accounts={accounts}
                value={selectedAccount || "all"}
                onChange={onAccountChange}
                allowAll
                allLabel="All Accounts"
                placeholder="All Accounts"
              />
            </div>
          </div>
        )}
        {children}
        {onSearchTextChange && (
          <div className="space-y-1.5">
            <Label className="text-xs">Search</Label>
            <Input placeholder="Search..." value={searchText || ""} onChange={(e) => onSearchTextChange(e.target.value)} className="w-40 h-9 text-sm" />
          </div>
        )}
        <Button size="sm" onClick={onSearch} disabled={loading} className="h-9">
          <Search className="w-4 h-4 mr-1" />{loading ? "Loading..." : "Generate"}
        </Button>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onExportPDF} className="h-8 text-xs">
          <Download className="w-3.5 h-3.5 mr-1" />PDF
        </Button>
        <Button variant="outline" size="sm" onClick={onExportExcel} className="h-8 text-xs">
          <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />Excel
        </Button>
        <Button variant="outline" size="sm" onClick={onPrint} className="h-8 text-xs">
          <Printer className="w-3.5 h-3.5 mr-1" />Print
        </Button>
      </div>
    </div>
  );
};
