<?php

namespace Tests;

use App\Services\LicenseService;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;

    protected function setUp(): void
    {
        parent::setUp();

        // The test database has no activated license, and the real service
        // would call the central license server. Treat the install as
        // licensed so LicenseGuard / AccountingService don't block every
        // request; a test that exercises licensing can rebind the service.
        $this->app->instance(LicenseService::class, new class($this->app['request']) extends LicenseService {
            public function getEffectiveStatus(): array
            {
                return [
                    'blocked' => false,
                    'status' => 'activated',
                    'message' => null,
                    'expires_at' => null,
                    'activated_at' => null,
                    'last_checked_at' => null,
                ];
            }
        });
    }
}
