<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * Minimal Google Drive client using OAuth2 authorization-code + refresh-token
 * flow. Configuration is stored per-installation in the `backup_settings` row.
 *
 * Deliberately uses plain cURL (ext-curl, part of core PHP) rather than
 * Laravel's Http:: facade (Guzzle) — this app's shared-hosting deployment
 * has no Composer available on the server itself, so adding the Guzzle
 * package it depends on isn't a safe same-session operation. cURL needs
 * nothing beyond what's already installed. See LicenseService for the same
 * pattern.
 */
class GoogleDriveService
{
    // drive.file alone only grants access to files/folders this app itself
    // creates — it can't list the user's existing folder tree or call
    // about.get for their account email. drive.metadata.readonly adds
    // read-only browsing of the whole Drive (needed for the folder picker
    // and the "Connected as ..." email) without granting content access
    // beyond what drive.file already allows for uploads.
    private const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/userinfo.email';

    public function __construct(
        private string $clientId = '',
        private string $clientSecret = '',
        private string $refreshToken = '',
        private ?string $folderId = null,
    ) {}

    public static function fromSettings(object $settings): self
    {
        return new self(
            (string) ($settings->gdrive_client_id ?? ''),
            (string) ($settings->gdrive_client_secret ?? ''),
            (string) ($settings->gdrive_refresh_token ?? ''),
            $settings->gdrive_folder_id ?? null,
        );
    }

    // ───────────────────────── OAuth (login) flow ─────────────────────────

    /**
     * Build the URL to send the admin's browser to for the Google consent
     * screen. `access_type=offline` + `prompt=consent` guarantee a refresh
     * token comes back even if this Google account has authorized the app
     * before.
     */
    public static function authUrl(string $clientId, string $redirectUri, string $state): string
    {
        $params = [
            'client_id' => $clientId,
            'redirect_uri' => $redirectUri,
            'response_type' => 'code',
            'scope' => self::DRIVE_SCOPE,
            'access_type' => 'offline',
            'prompt' => 'consent',
            'include_granted_scopes' => 'true',
            'state' => $state,
        ];
        return 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params);
    }

    /**
     * Exchange the authorization code Google sent to the callback for an
     * access + refresh token pair. Static: at this point we don't have a
     * refresh token yet to build a normal instance around.
     */
    public static function exchangeCode(string $clientId, string $clientSecret, string $code, string $redirectUri): array
    {
        return self::curlPostForm('https://oauth2.googleapis.com/token', [
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'code' => $code,
            'grant_type' => 'authorization_code',
            'redirect_uri' => $redirectUri,
        ]);
    }

    /**
     * Exchange the stored refresh token for a fresh access token.
     */
    public function accessToken(): string
    {
        if (!$this->clientId || !$this->clientSecret || !$this->refreshToken) {
            throw new \RuntimeException('Google Drive is not connected yet.');
        }

        $res = self::curlPostForm('https://oauth2.googleapis.com/token', [
            'client_id' => $this->clientId,
            'client_secret' => $this->clientSecret,
            'refresh_token' => $this->refreshToken,
            'grant_type' => 'refresh_token',
        ]);

        if (empty($res['access_token'])) {
            throw new \RuntimeException('Google OAuth token refresh failed: ' . ($res['error_description'] ?? $res['error'] ?? json_encode($res)));
        }

        return $res['access_token'];
    }

    /**
     * Verify credentials by calling /about. Returns the user info on success.
     */
    public function test(): array
    {
        $token = $this->accessToken();
        return self::curlGet('https://www.googleapis.com/drive/v3/about', $token, ['fields' => 'user,storageQuota']);
    }

    /**
     * List folders directly under the given parent (Drive's "My Drive"
     * root if omitted) — used by the folder-picker UI.
     */
    public function listFolders(?string $parentId = null): array
    {
        $token = $this->accessToken();
        $parent = $parentId ?: 'root';
        $q = "'" . str_replace("'", "\\'", $parent) . "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false";
        $res = self::curlGet('https://www.googleapis.com/drive/v3/files', $token, [
            'q' => $q,
            'fields' => 'files(id,name)',
            'orderBy' => 'name',
            'pageSize' => 200,
        ]);
        return $res['files'] ?? [];
    }

    /**
     * Create a new folder under the given parent and return its metadata.
     */
    public function createFolder(string $name, ?string $parentId = null): array
    {
        $token = $this->accessToken();
        $metadata = ['name' => $name, 'mimeType' => 'application/vnd.google-apps.folder'];
        if ($parentId) $metadata['parents'] = [$parentId];
        return self::curlPostJson('https://www.googleapis.com/drive/v3/files?fields=id,name', $token, $metadata);
    }

    /**
     * List non-folder files directly under the given parent — used by the
     * hourly backup job to find backups older than the Drive retention
     * window.
     */
    public function listFiles(?string $parentId = null): array
    {
        $token = $this->accessToken();
        $parent = $parentId ?: 'root';
        $q = "'" . str_replace("'", "\\'", $parent) . "' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false";
        $res = self::curlGet('https://www.googleapis.com/drive/v3/files', $token, [
            'q' => $q,
            'fields' => 'files(id,name,createdTime)',
            'orderBy' => 'createdTime desc',
            'pageSize' => 200,
        ]);
        return $res['files'] ?? [];
    }

    /**
     * Permanently delete a file from Drive (used by the retention cleanup).
     */
    public function deleteFile(string $fileId): void
    {
        $token = $this->accessToken();
        self::curlRequest('DELETE', 'https://www.googleapis.com/drive/v3/files/' . urlencode($fileId), ['Authorization: Bearer ' . $token], null, 'GDrive delete');
    }

    /**
     * Upload a local file to the configured folder (or root).
     * Returns the created file metadata.
     */
    public function upload(string $localPath, string $remoteName, string $mimeType = 'application/octet-stream'): array
    {
        if (!file_exists($localPath)) {
            throw new \RuntimeException("File not found: {$localPath}");
        }
        $token = $this->accessToken();

        $metadata = ['name' => $remoteName];
        if ($this->folderId) $metadata['parents'] = [$this->folderId];

        $boundary = 'erp-' . bin2hex(random_bytes(8));
        $body = "--{$boundary}\r\n"
            . "Content-Type: application/json; charset=UTF-8\r\n\r\n"
            . json_encode($metadata) . "\r\n"
            . "--{$boundary}\r\n"
            . "Content-Type: {$mimeType}\r\n\r\n"
            . file_get_contents($localPath) . "\r\n"
            . "--{$boundary}--";

        return self::curlRequest(
            'POST',
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
            [
                'Authorization: Bearer ' . $token,
                'Content-Type: multipart/related; boundary=' . $boundary,
            ],
            $body,
            'GDrive upload'
        );
    }

    // ───────────────────────── low-level cURL helpers ─────────────────────────

    private static function curlGet(string $url, string $token, array $query = []): array
    {
        if ($query) $url .= (str_contains($url, '?') ? '&' : '?') . http_build_query($query);
        return self::curlRequest('GET', $url, ['Authorization: Bearer ' . $token], null, 'GDrive request');
    }

    private static function curlPostJson(string $url, string $token, array $body): array
    {
        return self::curlRequest('POST', $url, [
            'Authorization: Bearer ' . $token,
            'Content-Type: application/json',
        ], json_encode($body), 'GDrive request');
    }

    private static function curlPostForm(string $url, array $fields): array
    {
        return self::curlRequest('POST', $url, ['Content-Type: application/x-www-form-urlencoded'], http_build_query($fields), 'Google OAuth');
    }

    private static function curlRequest(string $method, string $url, array $headers, ?string $body, string $label): array
    {
        $ch = curl_init($url);
        $opts = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => array_merge($headers, ['Accept: application/json']),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ];
        if ($body !== null) $opts[CURLOPT_POSTFIELDS] = $body;
        curl_setopt_array($ch, $opts);

        $responseBody = curl_exec($ch);
        $curlError = curl_error($ch);
        $httpStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($responseBody === false) {
            Log::warning("{$label} unreachable", ['url' => $url, 'error' => $curlError]);
            throw new \RuntimeException("{$label} failed: could not reach Google ({$curlError})");
        }

        $json = json_decode((string) $responseBody, true);
        if (!is_array($json)) $json = [];

        if ($httpStatus < 200 || $httpStatus >= 300) {
            $message = $json['error_description'] ?? $json['error']['message'] ?? $json['error'] ?? substr((string) $responseBody, 0, 300);
            Log::warning("{$label} failed", ['url' => $url, 'http_status' => $httpStatus, 'body' => $responseBody]);
            throw new \RuntimeException("{$label} failed ({$httpStatus}): " . (is_string($message) ? $message : json_encode($message)));
        }

        return $json;
    }
}
