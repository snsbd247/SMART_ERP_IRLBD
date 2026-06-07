<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * GitHub Deploy Sync — runs the VPS update.sh script in the background via a
 * pre-provisioned wrapper (deploy/vps/deploy-runner.sh, exposed as the
 * sudo command `smarterp-deploy`). Provides status polling + log tailing
 * for the frontend Pull & Deploy button.
 *
 * Security: Super Admin only (employee_id IS NULL). The wrapper is the
 * only thing www-data can sudo — see deploy/vps/quick-install.sh.
 */
class DeployController extends Controller
{
    private const LOG_FILE   = '/var/log/smarterp-deploy.log';
    private const PID_FILE   = '/var/run/smarterp-deploy.pid';
    private const STATE_FILE = '/var/log/smarterp-deploy.state';

    private function guard(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->isSuperAdmin()) {
            abort(response()->json([
                'success' => false,
                'message' => 'Only Super Admin can run deploy actions.',
            ], 403));
        }
    }

    /** POST /api/v1/admin/deploy/pull — start update.sh in background. */
    public function pull(Request $request)
    {
        try {
            $this->guard($request);

            if ($this->isRunning()) {
                return response()->json([
                    'success' => false,
                    'running' => true,
                    'message' => 'A deploy is already in progress.',
                ], 409);
            }

            $preflight = $this->preflightRunner();
            if ($preflight !== null) {
                return response()->json([
                    'success' => false,
                    'running' => false,
                    'message' => $preflight,
                ], 503);
            }

            $this->safeWrite(self::STATE_FILE, 'running');
            $this->safeAppend(self::LOG_FILE, "[" . date('H:i:s') . "] ▶ Pull & Deploy requested by {$request->user()->name}\n");

            // Run the wrapper detached so the HTTP request returns immediately.
            // sudo -n = non-interactive; nohup + & = background; output -> log file.
            $script = sprintf(
                'sudo -n /usr/local/bin/smarterp-deploy >> %s 2>&1; rc=$?; if [ $rc -ne 0 ]; then echo "[%s] DEPLOY FAILED: sudo runner exited with code $rc" >> %s; echo failed > %s; fi',
                escapeshellarg(self::LOG_FILE),
                date('H:i:s'),
                escapeshellarg(self::LOG_FILE),
                escapeshellarg(self::STATE_FILE)
            );
            @exec('sh -c ' . escapeshellarg($script) . ' >/dev/null 2>&1 &');

            return response()->json([
                'success' => true,
                'running' => true,
                'message' => 'Deploy started.',
            ]);
        } catch (Throwable $e) {
            Log::error('Deploy pull failed', ['error' => $e->getMessage(), 'trace' => $e->getTraceAsString()]);
            return response()->json([
                'success' => false,
                'running' => false,
                'message' => 'Deploy request failed: ' . $e->getMessage(),
            ], 500);
        }
    }

    private function preflightRunner(): ?string
    {
        if (!is_executable('/usr/local/bin/smarterp-deploy')) {
            return 'Deploy runner is not installed. Run: sudo APP_DIR=/opt/smarterp /opt/smarterp/deploy/vps/update.sh';
        }

        $output = [];
        $code = 0;
        @exec('sudo -n /usr/local/bin/smarterp-deploy --check 2>&1', $output, $code);
        if ($code !== 0) {
            $detail = trim(implode("\n", array_slice($output, -4)));
            return 'Deploy runner sudo permission check failed.' . ($detail ? " {$detail}" : ' Re-run update.sh as root.');
        }

        return null;
    }

    /** GET /api/v1/admin/deploy/status — running flag + last 200 log lines. */
    public function status(Request $request)
    {
        try {
            $this->guard($request);

            $running = $this->isRunning();
            $state   = is_file(self::STATE_FILE) ? trim((string) @file_get_contents(self::STATE_FILE)) : 'idle';
            if (!$running && $state === 'running') {
                // Process ended; mark final state based on last log line.
                $state = $this->detectFinalState();
                $this->safeWrite(self::STATE_FILE, $state);
            }

            $log = $this->tailLog(200);

            return response()->json([
                'success'  => true,
                'running'  => $running,
                'state'    => $state,       // idle | running | success | failed
                'log'      => $log,
                'log_size' => is_file(self::LOG_FILE) ? @filesize(self::LOG_FILE) : 0,
            ]);
        } catch (Throwable $e) {
            Log::error('Deploy status failed', ['error' => $e->getMessage(), 'trace' => $e->getTraceAsString()]);
            return response()->json([
                'success'  => false,
                'running'  => false,
                'state'    => 'failed',
                'log'      => $this->tailLog(200),
                'log_size' => is_file(self::LOG_FILE) ? @filesize(self::LOG_FILE) : 0,
                'message'  => 'Deploy status failed: ' . $e->getMessage(),
            ], 500);
        }
    }

    private function isRunning(): bool
    {
        if (!is_file(self::PID_FILE)) return false;
        $pid = (int) trim((string) @file_get_contents(self::PID_FILE));
        if ($pid <= 0) return false;
        return file_exists("/proc/{$pid}");
    }

    private function detectFinalState(): string
    {
        $tail = $this->tailLog(20);
        foreach (array_reverse(explode("\n", $tail)) as $line) {
            if (stripos($line, 'DEPLOY OK') !== false)    return 'success';
            if (stripos($line, 'DEPLOY FAILED') !== false) return 'failed';
        }
        return 'idle';
    }

    private function tailLog(int $lines = 200): string
    {
        if (!is_file(self::LOG_FILE)) return '';
        // Cheap tail: read whole file if small, else last 64KB.
        $size = @filesize(self::LOG_FILE) ?: 0;
        if ($size <= 65536) {
            $data = (string) @file_get_contents(self::LOG_FILE);
        } else {
            $fp = @fopen(self::LOG_FILE, 'r');
            if (!$fp) return '';
            fseek($fp, -65536, SEEK_END);
            $data = (string) stream_get_contents($fp);
            fclose($fp);
        }
        $arr = explode("\n", rtrim($data, "\n"));
        if (count($arr) > $lines) $arr = array_slice($arr, -$lines);
        return implode("\n", $arr);
    }
}
