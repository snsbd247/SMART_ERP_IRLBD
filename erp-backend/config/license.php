<?php

return [
    'server_url' => env('LICENSE_SERVER_URL', 'https://api.syncsolutionbd.com/api/v1'),
    'product_slug' => env('LICENSE_PRODUCT_SLUG', 'smart-erp'),

    // PEM keys don't survive literal newlines in every .env parser
    // reliably, so this is stored with escaped \n sequences and
    // unescaped here.
    'public_key_pem' => str_replace('\\n', "\n", (string) env('LICENSE_PUBLIC_KEY_PEM', '')),

    // How long a verify() result is trusted before a fresh check is made.
    'cache_ttl_hours' => 6,

    // How long the app keeps running on a cached (signature-valid) status
    // once the license server becomes unreachable, before blocking.
    'offline_grace_days' => 5,
];
