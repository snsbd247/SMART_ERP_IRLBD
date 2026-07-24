<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class DocumentMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        protected string $subjectLine,
        protected ?string $bodyText,
        protected string $documentHtml,
        protected ?string $documentTitle,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->subjectLine);
    }

    public function content(): Content
    {
        return new Content(htmlString: $this->renderHtml());
    }

    /**
     * Wrap the document HTML (which may already be a full document produced by
     * the frontend print view, or just a fragment) in a minimal shell, with the
     * optional cover message prepended above it.
     */
    private function renderHtml(): string
    {
        $isFullDocument = preg_match('/<html[\s>]/i', $this->documentHtml) === 1;

        $cover = trim((string) $this->bodyText) !== ''
            ? '<div style="white-space:pre-wrap;font-family:\'Segoe UI\',system-ui,sans-serif;font-size:14px;color:#1a1a1a;margin-bottom:20px;">'
                . nl2br(e($this->bodyText))
              . '</div><hr style="border:none;border-top:1px solid #ddd;margin-bottom:20px;">'
            : '';

        if ($isFullDocument) {
            // Inject the cover message right after <body ...> so we don't have to
            // parse/rebuild the whole document.
            if ($cover !== '') {
                return preg_replace('/(<body[^>]*>)/i', '$1' . $cover, $this->documentHtml, 1);
            }
            return $this->documentHtml;
        }

        $title = e($this->documentTitle ?: 'Document');

        return <<<HTML
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>{$title}</title>
</head>
<body style="margin:0;padding:20px;background:#fff;">
{$cover}
{$this->documentHtml}
</body>
</html>
HTML;
    }
}
