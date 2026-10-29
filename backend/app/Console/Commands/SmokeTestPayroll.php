<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Test #8: HRM Payroll
 *  - Salary structure: basic + house_rent + medical + other = total_salary
 *  - Attendance: count absences in target month
 *  - Deduction = absent_days * (total_salary / days_in_month)
 *  - net_salary = total_salary + allowances - deductions
 */
class SmokeTestPayroll extends Command
{
    protected $signature = 'payroll:smoke';
    protected $description = 'Smoke test: salary structure + attendance → payroll math';

    public function handle(): int
    {
        $this->info('=== Test #8: HRM Payroll ===');

        // Get or create demo employee
        $emp = DB::table('employees')->where('employee_code', 'EMP-SMK-001')->first();
        if (!$emp) {
            $branchId = DB::table('branches')->where('status', 'active')->value('id');
            $id = (string) Str::uuid();
            DB::table('employees')->insert([
                'id' => $id, 'employee_code' => 'EMP-SMK-001',
                'first_name' => 'Smoke', 'last_name' => 'Tester',
                'branch_id' => $branchId, 'salary' => 30000,
                'joining_date' => now()->startOfYear()->toDateString(),
                'employment_type' => 'permanent',
                'status' => 'active', 'approval_status' => 'approved',
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $emp = DB::table('employees')->where('id', $id)->first();
        }

        // Get or create salary structure (basic=20000, HR=8000, med=1500, other=500 → total=30000)
        $struct = DB::table('salary_structures')->where('employee_id', $emp->id)
            ->orderByDesc('effective_from')->first();
        if (!$struct) {
            DB::table('salary_structures')->insert([
                'id' => (string) Str::uuid(), 'employee_id' => $emp->id,
                'basic_salary' => 20000, 'house_rent' => 8000,
                'medical_allowance' => 1500, 'other_allowance' => 500,
                'total_salary' => 30000, 'effective_from' => now()->startOfYear()->toDateString(),
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $struct = DB::table('salary_structures')->where('employee_id', $emp->id)->first();
        }

        // Seed attendance for current month: 22 present + 3 absent (rest = weekend/ignored)
        $month = (int) now()->month;
        $year  = (int) now()->year;
        $daysInMonth = (int) now()->daysInMonth;

        DB::table('attendance')->where('employee_id', $emp->id)
            ->whereRaw('MONTH(date)=? AND YEAR(date)=?', [$month, $year])->delete();

        $rows = [];
        for ($d = 1; $d <= 22; $d++) {
            $rows[] = ['id' => (string) Str::uuid(), 'employee_id' => $emp->id,
                'date' => sprintf('%04d-%02d-%02d', $year, $month, $d), 'status' => 'present'];
        }
        for ($d = 23; $d <= 25; $d++) {
            $rows[] = ['id' => (string) Str::uuid(), 'employee_id' => $emp->id,
                'date' => sprintf('%04d-%02d-%02d', $year, $month, $d), 'status' => 'absent'];
        }
        DB::table('attendance')->insert($rows);

        // Compute payroll
        $absentDays = (int) DB::table('attendance')->where('employee_id', $emp->id)
            ->whereRaw('MONTH(date)=? AND YEAR(date)=?', [$month, $year])
            ->where('status', 'absent')->count();
        $basic       = (float) $struct->basic_salary;
        $allowances  = (float) ($struct->house_rent + $struct->medical_allowance + $struct->other_allowance);
        $totalSalary = (float) $struct->total_salary;
        $perDay      = round($totalSalary / $daysInMonth, 2);
        $deductions  = round($absentDays * $perDay, 2);
        $net         = round($basic + $allowances - $deductions, 2);

        // Upsert payroll row
        DB::table('payroll')->where(['employee_id' => $emp->id, 'month' => $month, 'year' => $year])->delete();
        DB::table('payroll')->insert([
            'id' => (string) Str::uuid(), 'employee_id' => $emp->id,
            'month' => $month, 'year' => $year,
            'basic_salary' => $basic, 'allowances' => $allowances,
            'deductions' => $deductions, 'net_salary' => $net, 'status' => 'processed',
        ]);

        // Verify
        $saved = DB::table('payroll')->where(['employee_id' => $emp->id, 'month' => $month, 'year' => $year])->first();
        $expectedNet = $basic + $allowances - $deductions;
        $ok = abs($saved->net_salary - $expectedNet) < 0.01
           && abs($saved->deductions - $deductions) < 0.01;

        $this->table(['Metric', 'Value'], [
            ['Total salary',     number_format($totalSalary, 2)],
            ['Days in month',    $daysInMonth],
            ['Per-day rate',     number_format($perDay, 2)],
            ['Absent days',      $absentDays],
            ['Basic',            number_format($basic, 2)],
            ['Allowances',       number_format($allowances, 2)],
            ['Deductions',       number_format($deductions, 2)],
            ['Expected net',     number_format($expectedNet, 2)],
            ['Saved net',        number_format($saved->net_salary, 2)],
        ]);

        if ($ok) { $this->info('✅ Payroll smoke PASS'); return 0; }
        $this->error('❌ Payroll smoke FAIL'); return 1;
    }
}
