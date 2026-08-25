<?php

namespace App\Http\Controllers;

use App\Services\LicenseService;
use Illuminate\Http\Request;

class LicenseController extends BaseController
{
    public function __construct(private LicenseService $license) {}

    public function status()
    {
        return $this->success($this->license->getEffectiveStatus());
    }

    public function activate(Request $request)
    {
        $data = $request->validate([
            'license_key' => 'required|string|max:255',
        ]);

        $result = $this->license->activate($data['license_key']);
        if (!$result['ok']) {
            return $this->error($result['message'], 422, ['status' => $result['status']]);
        }

        return $this->success($result);
    }
}
