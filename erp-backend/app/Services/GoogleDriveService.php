<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Minimal Google Drive client using OAuth2 refresh-token flow.
 *
 * Configuration is stored per-installation in the `backup_settings` row.
 * We deliberately avoid the official google/apiclient SDK to keep the
 * dependency footprint small and remain compatible with shared hosting.
 */
class GoogleDriveService
{
    public function __construct(
        private string $clientId,
        private string $clientSecret,
        private string $refreshToken,
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

    /**
     * Exchange the stored refresh token for a fresh access token.
     */
    public function accessToken(): string
    {
        if (!$this->clientId || !$this->clientSecret || !$this->refreshToken) {
            throw new \RuntimeException('Google Drive credentials are not fully configured.');
        }

        $res = Http::asForm()->post('https://oauth2.googleapis.com/token', [
            'client_id' => $this->clientId,
            'client_secret' => $this->clientSecret,
            'refresh_token' => $this->refreshToken,
            'grant_type' => 'refresh_token',
        ]);

        if (!$res->ok() || empty($res->json('access_token'))) {
            throw new \RuntimeException('Google OAuth token refresh failed: ' . $res->body());
        }

        return $res->json('access_token');
    }

    /**
     * Verify credentials by calling /about. Returns the user info on success.
     */
    public function test(): array
    {
        $token = $this->accessToken();
        $res = Http::withToken($token)
            ->get('https://www.googleapis.com/drive/v3/about', ['fields' => 'user,storageQuota']);
        if (!$res->ok()) {
            throw new \RuntimeException('Google Drive test failed: ' . $res->body());
        }
        return $res->json();
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

        $res = Http::withToken($token)
            ->withHeaders(['Content-Type' => "multipart/related; boundary={$boundary}"])
            ->withBody($body, "multipart/related; boundary={$boundary}")
            ->post('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink');

        if (!$res->ok()) {
            Log::warning('GDrive upload failed: ' . $res->body());
            throw new \RuntimeException('Google Drive upload failed: ' . $res->body());
        }
        return $res->json();
    }
}
