# Supabase → VPS MySQL Data Migration (One-Off)

ভিপিএস-এর MySQL ডাটাবেজ খালি হলে Lovable Supabase প্রজেক্ট থেকে সব ডাটা এক বার নিয়ে আসার জন্য নিচের ধাপগুলো অনুসরণ করুন। অ্যাপের কোডে কোনো Supabase লিংক যুক্ত হয় না — শুধু একটি artisan command HTTP-এ ডাটা টানে।

## ১. Supabase service_role key বের করুন
Dashboard → Project Settings → API → `service_role` secret key কপি করুন।

## ২. VPS-এ লগইন করে .env এডিট করুন
```bash
cd /opt/smarterp/erp-backend
nano .env
```
নিচের ২টি লাইন **সাময়িকভাবে** যোগ করুন:
```
SUPABASE_URL=https://ezwsrtsqiumhxukwgiou.supabase.co
SUPABASE_SERVICE_KEY=<paste service_role key>
```

## ৩. কনফিগ ক্লিয়ার করে কমান্ড চালান
```bash
php artisan config:clear
php artisan data:pull-from-supabase --dry-run        # প্রথমে count দেখুন
php artisan data:pull-from-supabase --truncate       # আসল ইমপোর্ট
```

অপশন:
- `--truncate` — ইমপোর্টের আগে টার্গেট টেবিল খালি করে
- `--only=chart_of_accounts,profiles` — নির্দিষ্ট টেবিল
- `--dry-run` — শুধু count দেখাবে, ইনসার্ট করবে না

## ৪. .env থেকে কী মুছে ফেলুন (গুরুত্বপূর্ণ)
ইমপোর্ট শেষ হলে `SUPABASE_URL` ও `SUPABASE_SERVICE_KEY` লাইন দু'টি .env থেকে ডিলিট করে দিন, তারপর:
```bash
php artisan config:clear && php artisan config:cache
```

## কিভাবে কাজ করে
- Laravel-এর built-in `Http` client দিয়ে Supabase REST (`/rest/v1/<table>`) থেকে rows fetch করে
- যে কলামগুলো MySQL টেবিলে আসলেই আছে শুধু সেগুলোই ইনসার্ট হয়
- FK order maintain করার জন্য parent → child sequence-এ চালানো হয়
- `insertOrIgnore` ব্যবহার করায় ডুপ্লিকেট PK থাকলে স্কিপ হয়, error হয় না
- কোনো Supabase SDK/composer dependency যুক্ত করা হয়নি — শুধু HTTP call
