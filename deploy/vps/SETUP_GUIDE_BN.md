# 🚀 SmartERP — Fresh VPS Install Guide (erp.irlbd.com)

> এই গাইড ধরে নিচ্ছে আপনি **OS রিইনস্টল** করে নতুন Ubuntu 22.04 / 24.04 VPS থেকে শুরু করছেন।
> মাত্র **৩টি ধাপ** — DNS → এক কমান্ড ইনস্টল → লগইন।

---

## 🌐 ডোমেইন স্ট্র্যাটেজি

| Environment | Domain | Backend | Database |
|---|---|---|---|
| **VPS Production** | `erp.irlbd.com` | Laravel API (same-origin `/api`) | VPS MySQL (`smarterp`) |

Frontend (`src/lib/laravel-auth.ts`) সবসময় same-origin Laravel API ব্যবহার করে — কোনো Cloud/Supabase dependency নেই।

---

## আপনার সার্ভার তথ্য

| বিষয় | মান |
|---|---|
| Domain | `erp.irlbd.com` |
| Server IP | `163.227.239.159` |
| GitHub Repo | `https://github.com/snsbd247/audit-treasure-6d69be20.git` |
| App folder | `/opt/smarterp` |
| DB / User / Pass | `smarterp` / `smarterp` / `StrongPass@2026` |
| Admin login | `admin / Admin@123` |

---

## ধাপ ০ — DNS সেট করুন (বাধ্যতামূলক, সবার আগে)

ডোমেইন প্রোভাইডারে A রেকর্ড যোগ করুন:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `erp` | `163.227.239.159` | 3600 |

Verify (যেকোনো মেশিন থেকে):
```bash
ping erp.irlbd.com
```
উত্তরে `163.227.239.159` আসলেই DNS ready।  Propagation-এ ৫–৩০ মিনিট লাগতে পারে। DNS ready না হলে SSL ধাপ ব্যর্থ হবে।

---

## ধাপ ১ — VPS-এ root হিসেবে লগইন

```bash
ssh root@163.227.239.159
```

---

## ধাপ ২ — One-Command Fresh Install 🎉

নিচের **একটি কমান্ড**ই যথেষ্ট — এটি একসাথে করেঃ

1. Base setup (Nginx + PHP 8.2 + MySQL + Node 20 + Composer + UFW)
2. MySQL ডাটাবেজ `smarterp` + ইউজার তৈরি
3. GitHub থেকে কোড clone + frontend build + composer install
4. `.env` কনফিগ + `key:generate` + `migrate --seed` (canonical company settings + admin user)
5. Nginx vhost + same-origin `/api` routing + reload
6. SSL সার্টিফিকেট (Let's Encrypt) + HTTPS redirect
7. Pull & Deploy runner (`/usr/local/bin/smarterp-deploy`) ইনস্টল

```bash
curl -fsSL https://raw.githubusercontent.com/snsbd247/audit-treasure-6d69be20/main/deploy/vps/quick-install.sh -o /tmp/qi.sh \
  && chmod +x /tmp/qi.sh \
  && sudo DOMAIN=erp.irlbd.com \
          ADMIN_EMAIL=admin@irlbd.com \
          DB_PASS='StrongPass@2026' \
          /tmp/qi.sh
```

⏱️ সময়: **১০–২০ মিনিট** (ইন্টারনেট স্পিড অনুযায়ী)।

💡 DNS এখনো propagate না হলে SSL স্কিপ করতে `SKIP_SSL=1` যোগ করুন:
```bash
sudo DOMAIN=erp.irlbd.com SKIP_SSL=1 /tmp/qi.sh
# পরে DNS ready হলে:
sudo certbot --nginx -d erp.irlbd.com
```

শেষে দেখাবেঃ
```
✅ All done!  Open:  https://erp.irlbd.com
```
এবং `/root/smarterp-credentials.txt`-এ সব credentials সংরক্ষিত হবে।

---

## ধাপ ৩ — প্রথম লগইন

URL: **https://erp.irlbd.com**

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `Admin@123` |

লগইন করেই **Profile → Change Password** থেকে পাসওয়ার্ড বদলে নিন।

---

## ✅ ইনস্টলেশন যাচাই (verification)

```bash
# Backend health
curl -s https://erp.irlbd.com/api/health | head

# Frontend loads
curl -sI https://erp.irlbd.com | head -1     # → HTTP/2 200

# Company settings singleton ঠিক আছে কিনা
sudo mysql -u smarterp -p'StrongPass@2026' smarterp -e \
  "SELECT id, company_name, currency_code FROM company_settings;"
# একটি মাত্র row আসবে, id='default'
```

General Settings পেজে গিয়ে কোম্পানি নাম/লোগো সেভ করুন → reload করুন → ডাটা থাকবে।

---

## 🔄 ভবিষ্যতে আপডেট

GitHub-এ নতুন কোড push হলে শুধু একটি কমান্ড:

```bash
sudo APP_DIR=/opt/smarterp /opt/smarterp/deploy/vps/update.sh
```

অথবা ERP-র ভিতরে **Admin → GitHub Deploy Sync → Pull & Deploy** চাপুন।

✅ **পুরোনো ডাটা ডিলিট হয় না** — শুধু কোড ও schema additive ভাবে আপডেট হয়
✅ Migration চালানোর আগে automatic backup নেয় (`/var/backups/smarterp/`)
✅ Seeder কখনো run হয় না update-এ (operational data সুরক্ষিত)

---

## 🆘 সমস্যা হলে চেক করুন

| সমস্যা | কমান্ড |
|---|---|
| Credentials দেখুন | `sudo cat /root/smarterp-credentials.txt` |
| সাইট খুলছে না | `sudo systemctl status nginx` |
| 502 Bad Gateway | `sudo systemctl status php8.2-fpm` |
| Login 500 error | `sudo APP_DIR=/opt/smarterp /opt/smarterp/deploy/vps/update.sh` |
| DB / app error | `sudo tail -50 /opt/smarterp/erp-backend/storage/logs/laravel.log` |
| Nginx error | `sudo tail -50 /var/log/nginx/error.log` |
| Cache clear | `cd /opt/smarterp/erp-backend && sudo -u www-data php artisan optimize:clear` |
| Restart সব | `sudo systemctl restart nginx php8.2-fpm mysql` |
| SSL আবার চালান | `sudo certbot --nginx -d erp.irlbd.com` |

### General Settings সেভ হলেও reload-এ মুছে যাচ্ছে?

এটা পুরোনো deploy-এ frontend-backend split-এর কারণে হতো। Latest code-এ ঠিক করা — শুধু update চালানঃ
```bash
sudo APP_DIR=/opt/smarterp /opt/smarterp/deploy/vps/update.sh
cd /opt/smarterp/erp-backend && sudo -u www-data php artisan optimize:clear
```
তারপর browser-এ **Ctrl + Shift + R** (hard reload)।

---

## 💣 সম্পূর্ণ Reset / Fresh Reinstall (সাবধান — সব data মুছবে)

```bash
# 1. পুরো backup নিন
sudo mysqldump -u smarterp -p'StrongPass@2026' smarterp | gzip > ~/smarterp-backup-$(date +%F).sql.gz

# 2. App folder ও DB মুছুন
sudo rm -rf /opt/smarterp
sudo mysql -e "DROP DATABASE IF EXISTS smarterp; DROP USER IF EXISTS 'smarterp'@'localhost';"

# 3. উপরের ধাপ ২ আবার চালান
```

---

## 📦 Backup

```bash
ls -lh /var/backups/smarterp/                                                  # auto backups
sudo mysqldump -u smarterp -p smarterp | gzip > ~/smarterp-$(date +%F).sql.gz  # manual
```

---

## ⚙️ Advanced — ধাপ ধাপে চালাতে চাইলে

`quick-install.sh`-এর প্রতিটি ধাপ আলাদা স্ক্রিপ্টেও আছেঃ

| ধাপ | স্ক্রিপ্ট |
|---|---|
| Base প্যাকেজ | `deploy/vps/setup.sh` |
| Clone + build | `deploy/vps/clone.sh` |
| পরবর্তী আপডেট | `deploy/vps/update.sh` |

সাধারণ ব্যবহারে শুধু **ধাপ ২-এর এক কমান্ড**ই যথেষ্ট।

---

**শুভ কামনা! 🎉**  সমস্যা হলে error log-সহ জানান।
