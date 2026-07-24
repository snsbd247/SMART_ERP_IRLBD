<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\BaseController;
use App\Services\SmsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SmsController extends BaseController
{
    /**
     * Send an ad-hoc test SMS via the configured Greenweb API.
     */
    public function send(Request $request): JsonResponse
    {
        if (!$request->user()->isSuperAdmin()) {
            return $this->error('Only Super Admins can send test SMS.', 403);
        }

        $request->validate([
            'phone' => 'required|string',
            'message' => 'required|string',
            'event_type' => 'nullable|string',
        ]);

        $sent = app(SmsService::class)->sendSMS(
            $request->phone,
            $request->message,
            $request->event_type ?? 'test'
        );

        if (!$sent) {
            return $this->error('Failed to send SMS. Check SMS settings (enabled / API key) and logs.', 422);
        }

        return $this->success(null, 'Test SMS sent successfully');
    }
}
