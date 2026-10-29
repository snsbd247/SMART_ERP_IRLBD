<?php

namespace App\Services;

use App\Models\LicenseState;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Talks to the central license server (config/license.php) to activate
 * and verify this deployment's license, caches the result locally in
 * license_state, and decides whether the app should be blocked.
 *
 * Every server response is RSA-signature-verified before it is trusted —
 * a row in license_state only ever reflects a response that carried a
 * valid signature from the license server's private key. Hand-editing
 * this table (e.g. UPDATE license_state SET status='active') does not
 * produce a value that will pass verifySignature() again, since nothing
 * here re-derives trust from the stored row alone; every call either
 * carries a fresh signed response or falls back to the cached row
 * strictly within the offline-grace window, never re-signs stale data.
 *
 * getEffectiveStatus() is the single entry point everything else
 * (LicenseGuard middleware, the /license/status endpoint, and the
 * business-logic-level check in AccountingService) should call.
 */
class LicenseService
{
    private const SINGLETON_ID = 'default';
    private const BLOCKED_STATUSES = ['expired', 'suspended', 'revoked', 'denied', 'unconfigured', 'offline_expired'];

    public function __construct(private Request $request) {}

    public function currentDomain(): string
    {
        return $this->request->getHost();
    }

    private function row(): LicenseState
    {
        return LicenseState::firstOrCreate(
            ['id' => self::SINGLETON_ID],
            ['status' => 'unconfigured']
        );
    }

    /**
     * Canonical string the server signs: "{status}|{license_key}|{domain}|{expires_at}",
     * missing fields serialize as "". Field order and exact formatting must
     * match the license server exactly or every signature will fail.
     */
    private function canonicalString(array $resp): string
    {
        $parts = [
            (string) ($resp['status'] ?? ''),
            (string) ($resp['license_key'] ?? ''),
            (string) ($resp['domain'] ?? ''),
            (string) ($resp['expires_at'] ?? ''),
        ];
        return implode('|', $parts);
    }

    private function verifySignature(array $resp): bool
    {
        $publicKey = config('license.public_key_pem');
        $signature = $resp['signature'] ?? null;
        if (!$publicKey || !$signature) return false;

        $decoded = base64_decode((string) $signature, true);
        if ($decoded === false) return false;

        $canonical = $this->canonicalString($resp);
        $result = openssl_verify($canonical, $decoded, $publicKey, OPENSSL_ALGO_SHA256);
        return $result === 1;
    }

    /**
     * Plain cURL (ext-curl, part of core PHP) rather than Laravel's Http::
     * facade — this app's shared-hosting deployment has no Composer
     * available on the server itself, so adding the Guzzle package it
     * depends on isn't a safe same-session operation. cURL needs nothing
     * beyond what's already installed.
     *
     * @return array{network_ok: bool, signature_ok: bool, http_status: ?int, body: array}
     */
    private function call(string $path, array $body): array
    {
        $url = rtrim(config('license.server_url'), '/') . '/' . ltrim($path, '/');
        $payload = json_encode($body);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $responseBody = curl_exec($ch);
        $curlError = curl_error($ch);
        $httpStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($responseBody === false) {
            Log::warning('License server unreachable', ['path' => $path, 'error' => $curlError]);
            return ['network_ok' => false, 'signature_ok' => false, 'http_status' => null, 'body' => []];
        }

        $json = json_decode((string) $responseBody, true);
        if (!is_array($json)) {
            Log::warning('License server returned non-JSON response', ['path' => $path, 'http_status' => $httpStatus, 'raw' => substr((string) $responseBody, 0, 500)]);
            return ['network_ok' => false, 'signature_ok' => false, 'http_status' => $httpStatus, 'body' => []];
        }

        $signatureOk = $this->verifySignature($json);
        if (!$signatureOk) {
            Log::error('License server response failed signature verification', ['path' => $path, 'body' => $json]);
        }

        return ['network_ok' => true, 'signature_ok' => $signatureOk, 'http_status' => $httpStatus, 'body' => $json];
    }

    /**
     * Persist a signature-verified response into license_state. Never
     * call this with an unverified response. $isActivation is only true
     * when called from activate() — that's the sole place activated_at
     * should move, so routine verify() refreshes never touch it.
     */
    private function persist(array $body, bool $isActivation = false): void
    {
        $row = $this->row();
        $row->fill([
            'license_key' => $body['license_key'] ?? $row->license_key,
            'status' => $body['status'] ?? $row->status,
            'expires_at' => $body['expires_at'] ?? null,
            'last_checked_at' => now(),
            'last_check_ok' => true,
            'message' => $body['message'] ?? null,
            'signature' => $body['signature'] ?? null,
        ]);
        if ($isActivation && in_array($row->status, ['activated', 'already_active'], true)) {
            $row->activated_at = now();
        }
        $row->save();
    }

    /**
     * One-time activation with a license key. Returns the outcome for the
     * UI to display directly — never throws for a legitimate server
     * rejection (denied/404/409), only for unreachable/untrusted responses.
     */
    public function activate(string $licenseKey): array
    {
        $domain = $this->currentDomain();
        $result = $this->call('license/activate', [
            'license_key' => $licenseKey,
            'domain' => $domain,
            'product_slug' => config('license.product_slug'),
        ]);

        if (!$result['network_ok']) {
            return ['ok' => false, 'status' => 'network_error', 'message' => 'Could not reach the license server. Check your internet connection and try again.'];
        }
        if (!$result['signature_ok']) {
            return ['ok' => false, 'status' => 'signature_error', 'message' => 'License server response could not be verified. Please try again or contact support.'];
        }

        $this->persist($result['body'], true);

        $status = $result['body']['status'] ?? 'denied';
        $ok = in_array($status, ['activated', 'already_active'], true);
        return [
            'ok' => $ok,
            'status' => $status,
            'message' => $result['body']['message'] ?? ($ok ? 'License activated.' : 'License activation was rejected.'),
            'expires_at' => $result['body']['expires_at'] ?? null,
        ];
    }

    /**
     * Re-verify the currently stored license key against the license
     * server. Respects the cache TTL unless $force is true.
     */
    public function verify(bool $force = false): array
    {
        $row = $this->row();
        if (!$row->license_key) {
            return ['network_ok' => true, 'signature_ok' => true, 'skipped' => false];
        }

        if (!$force && $row->last_checked_at && $row->last_checked_at->gt(now()->subHours((int) config('license.cache_ttl_hours')))) {
            return ['network_ok' => true, 'signature_ok' => true, 'skipped' => true];
        }

        $result = $this->call('license/verify', [
            'license_key' => $row->license_key,
            'domain' => $this->currentDomain(),
        ]);

        if ($result['network_ok'] && $result['signature_ok']) {
            $this->persist($result['body']);
        }

        return ['network_ok' => $result['network_ok'], 'signature_ok' => $result['signature_ok'], 'skipped' => false];
    }

    /**
     * The single source of truth for "is this app allowed to run right
     * now". Refreshes from the server when the cache is stale; on
     * failure (network or signature), falls back to the last trustworthy
     * cached status as long as it's within the offline-grace window.
     */
    public function getEffectiveStatus(): array
    {
        $row = $this->row();

        if (!$row->license_key) {
            return ['blocked' => true, 'status' => 'unconfigured', 'message' => 'No license key has been activated for this installation.', 'expires_at' => null, 'activated_at' => null, 'last_checked_at' => null];
        }

        $this->verify(); // no-ops internally if cache is still fresh
        $row = $this->row()->fresh();

        $graceDeadline = $row->last_checked_at?->copy()->addDays((int) config('license.offline_grace_days'));
        if (!$row->last_checked_at || !$graceDeadline || now()->gt($graceDeadline)) {
            return [
                'blocked' => true,
                'status' => 'offline_expired',
                'message' => 'This license could not be verified and the offline grace period has expired. Please check your internet connection or contact support.',
                'expires_at' => $row->expires_at?->toIso8601String(),
                'activated_at' => $row->activated_at?->toIso8601String(),
                'last_checked_at' => $row->last_checked_at?->toIso8601String(),
            ];
        }

        return [
            'blocked' => in_array($row->status, self::BLOCKED_STATUSES, true),
            'status' => $row->status,
            'message' => $row->message,
            'expires_at' => $row->expires_at?->toIso8601String(),
            'activated_at' => $row->activated_at?->toIso8601String(),
            'last_checked_at' => $row->last_checked_at?->toIso8601String(),
        ];
    }

    /**
     * Force a fresh check against the license server (bypasses the
     * cache-TTL short-circuit in verify()), then return the effective
     * status — used by the "Recheck license now" UI action.
     */
    public function recheck(): array
    {
        $this->verify(true);
        return $this->getEffectiveStatus();
    }
}
