import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dataClient } from "@/integrations/data/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Landmark, Plus, Pencil, Trash2 } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";

const BankAccountsPage = () => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const { fc } = useCurrency();
  const navigate = useNavigate();

  useEffect(() => {
    dataClient
      .from("chart_of_accounts")
      .select("*")
      .ilike("account_name", "%bank%")
      .eq("is_active", true)
      .then(({ data }) => setAccounts(data || []));
  }, []);

  return (
    <div className="p-4 lg:p-6 max-w-[1200px] mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">Bank Accounts</h1>
        <Button onClick={() => navigate("/accounts/chart?new=bank")} size="sm">
          <Plus className="w-4 h-4 mr-2" />Add Bank Account
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Landmark className="w-4 h-4" />Bank Accounts from Chart of Accounts
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Opening Balance</TableHead>
                <TableHead className="w-20 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.account_code}</TableCell>
                  <TableCell className="font-medium">{a.account_name}</TableCell>
                  <TableCell>{a.account_type}</TableCell>
                  <TableCell className="text-right tabular-nums">{fc(Number(a.opening_balance))}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/accounts/chart?edit=${a.id}`)}
                        aria-label={`Edit ${a.account_name}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => navigate(`/accounts/chart?delete=${a.id}`)}
                        aria-label={`Delete ${a.account_name}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {accounts.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No bank accounts found. Click "Add Bank Account" to create one (account name must contain "Bank").</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default BankAccountsPage;
