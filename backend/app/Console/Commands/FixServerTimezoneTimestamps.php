<?php

namespace App\Console\Commands;

use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * One-time repair for timestamps that were filled by the column default
 * CURRENT_TIMESTAMP on the cPanel host, whose MySQL runs in US Eastern time
 * instead of APP_TIMEZONE (Asia/Dhaka). Those values are wall-clock times
 * in --from-tz; this rewrites them to the same instant in app time.
 *
 * Only rows proven (by code path and by cross-checking against app-written
 * timestamps) to come from the DB default are touched:
 *   - audit_log rows written server-side through AuditLog::create
 *     (frontend-logged rows already carry app time and are skipped)
 *   - user_activities, payroll (models never set created_at)
 * and only between --since (when this server went live; older rows were
 * restored from the previous system) and --before (default: DB NOW(), i.e.
 * run it right after deploying the AppTimestamps fix — rows written after
 * that fix are in app time and are > NOW() in server time).
 *
 * Writes a JSON backup of every original value and refuses to run twice.
 */
class FixServerTimezoneTimestamps extends Command
{
    protected $signature = 'timestamps:fix-server-timezone
        {--dry-run : Show what would change without writing}
        {--since=2026-07-24 06:00:00 : Server-time lower bound (go-live on this host)}
        {--before= : Server-time upper bound (default: DB NOW())}
        {--from-tz=America/New_York : Time zone the DB server stamped values in}
        {--force : Run even if a previous run was recorded}';

    protected $description = 'Convert DB-default timestamps written in the MySQL server time zone to APP_TIMEZONE';

    private const MARKER = 'tz-fix/done.json';

    /** Server-side audit actions/modules (AuditLog::create / AuditService). */
    private const AUDIT_ACTIONS = [
        'voucher_soft_deleted', 'voucher_split_inter_branch_transfer', 'voucher_type_changed',
        'reject_inactive_fy', 'approve_registration', 'Data Transfer & Delete',
    ];
    private const AUDIT_MODULES_ANY_ACTION = [
        'hrm.attendance', 'inventory', 'manufacturing_production', 'purchase_returns',
        'sales_invoices', 'sales_returns', 'vouchers',
    ];
    private const AUDIT_MODULES_CRUD = ['company_settings', 'users'];

    public function handle(): int
    {
        $dry = (bool) $this->option('dry-run');
        if (!$dry && Storage::disk('local')->exists(self::MARKER) && !$this->option('force')) {
            $this->error('Already run (' . Storage::disk('local')->path(self::MARKER) . '). Use --force to run again.');
            return 1;
        }

        $since = (string) $this->option('since');
        $before = $this->option('before') ?: DB::selectOne('select now() n')->n;
        $fromTz = (string) $this->option('from-tz');
        $toTz = config('app.timezone');
        $this->info("Converting [{$since}, {$before}) from {$fromTz} to {$toTz}" . ($dry ? ' (dry run)' : ''));

        $sets = [
            'audit_log' => fn ($q) => $q->where(function ($w) {
                $w->whereIn('action', self::AUDIT_ACTIONS)
                  ->orWhere('action', 'like', 'permission_denied%')
                  ->orWhereIn('module', self::AUDIT_MODULES_ANY_ACTION)
                  ->orWhere(fn ($c) => $c->whereIn('module', self::AUDIT_MODULES_CRUD)->whereIn('action', ['create', 'edit', 'delete']));
            }),
            'user_activities' => fn ($q) => $q,
            'payroll' => fn ($q) => $q,
        ];

        $backup = [];
        DB::beginTransaction();
        try {
            foreach ($sets as $table => $scope) {
                $rows = $scope(DB::table($table))
                    ->where('created_at', '>=', $since)
                    ->where('created_at', '<', $before)
                    ->get(['id', 'created_at']);

                foreach ($rows as $row) {
                    $new = Carbon::parse($row->created_at, $fromTz)->setTimezone($toTz)->format('Y-m-d H:i:s');
                    $backup[] = ['table' => $table, 'id' => $row->id, 'old' => $row->created_at, 'new' => $new];
                    if (!$dry) {
                        DB::table($table)->where('id', $row->id)->update(['created_at' => $new]);
                    }
                }
                $first = $rows->isEmpty() ? null : $backup[count($backup) - $rows->count()];
                $this->line(sprintf('  %-16s %5d rows%s', $table, $rows->count(),
                    $first ? "  e.g. {$first['old']} -> {$first['new']}" : ''));
            }

            if ($dry) {
                DB::rollBack();
                $this->info('Dry run: nothing written. ' . count($backup) . ' rows would change.');
                return 0;
            }

            $file = 'tz-fix/backup-' . now()->format('Ymd-His') . '.json';
            // Backup of the original values goes to disk before commit.
            Storage::disk('local')->put($file, json_encode(['since' => $since, 'before' => $before, 'from_tz' => $fromTz, 'to_tz' => $toTz, 'rows' => $backup], JSON_PRETTY_PRINT));
            DB::commit();
        } catch (\Throwable $e) {
            DB::rollBack();
            $this->error('Failed, nothing changed: ' . $e->getMessage());
            return 1;
        }
        Storage::disk('local')->put(self::MARKER, json_encode(['at' => now()->toIso8601String(), 'rows' => count($backup), 'backup' => $file]));

        $this->info(count($backup) . ' rows converted. Original values: ' . Storage::disk('local')->path($file));
        return 0;
    }
}
