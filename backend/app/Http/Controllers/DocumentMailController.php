<?php

namespace App\Http\Controllers;

use App\Mail\DocumentMail;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class DocumentMailController extends BaseController
{
    /**
     * Email a printed document (invoice, purchase, ledger, statement, etc.)
     * as HTML, generated client-side by PrintLayout and posted here.
     */
    public function send(Request $request): JsonResponse
    {
        $request->validate([
            'to' => 'required|email',
            'subject' => 'required|string',
            'body' => 'nullable|string',
            'document_html' => 'required|string',
            'document_title' => 'nullable|string',
        ]);

        try {
            Mail::to($request->to)->send(new DocumentMail(
                $request->subject,
                $request->body,
                $request->document_html,
                $request->document_title
            ));

            // Accountability: every email sent from the company address is traceable to a user.
            Log::info('Document email sent', [
                'user_id' => $request->user()?->id,
                'user' => $request->user()?->username,
                'to' => $request->to,
                'subject' => mb_substr((string) $request->subject, 0, 200),
                'ip' => $request->ip(),
            ]);

            return $this->success(null, 'Email sent successfully');
        } catch (\Throwable $e) {
            Log::error('Document email send failed: ' . $e->getMessage());
            return $this->error('Failed to send email: ' . $e->getMessage(), 500);
        }
    }
}
