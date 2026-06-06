# 🚀 SmartERP — VPS Setup Guide (erp.irlbd.com)

আপনার সার্ভার তথ্য:

| বিষয় | মান |
|---|---|
| Domain | `erp.irlbd.com` |
| Server IP | `163.227.239.159` |
| GitHub Repo | `https://github.com/snsbd247/audit-treasure-6d69be20.git` |
| App folder | `/opt/smarterp` |
| Admin login | `admin / Admin@123` (প্রথম login-এর পরেই পাল্টে নিন) |

---

## ধাপ ০ — DNS সেট করুন (সবচেয়ে আগে)

আপনার ডোমেইন প্রোভাইডারে গিয়ে নিচের রেকর্ড যোগ করুন:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `erp` | `163.227.239.159` | 3600 |

✅ Verify (আপনার computer/mobile থেকে):
```bash
ping erp.irlbd.com
```
উত্তরে `163.227.239.159` আসলে DNS ঠিক আছে। (DNS propagation-এ ৫–৩০ মিনিট লাগতে পারে)।

---

## ধাপ ১ — VPS-এ লগইন

আপনার computer-এর terminal খুলে:
```bash
ssh root@163.227.239.159
```
পাসওয়ার্ড দিন। লগইন হলে পরের ধাপে যান।

---

## ধাপ ২ — Base সিস্টেম সেটাপ (Nginx + PHP + MySQL + Node)

নিচের কমান্ডটি **একবারে** কপি করে paste করুন:

```bash
curl -fsSL https://raw.githubusercontent.com/snsbd247/audit-treasure-6d69be20/main/deploy/vps/setup.sh -o /tmp/setup.sh \
  && chmod +x /tmp/setup.sh \
  && sudo /tmp/setup.sh
```

⏱️ ৫–১০ মিনিট লাগবে। শেষে দেখাবে: `Base VPS setup complete.`

---

## ধাপ ৩ — MySQL ডাটাবেজ তৈরি করুন

```bash
sudo mysql <<'SQL'
CREATE DATABASE smarterp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'smarterp'@'localhost' IDENTIFIED BY 'StrongPass@2026';
GRANT ALL PRIVILEGES ON smarterp.* TO 'smarterp'@'localhost';
FLUSH PRIVILEGES;
SQL
```

> 🔒 `StrongPass@2026` — এটি বদলে আপনার নিজের শক্তিশালী পাসওয়ার্ড দিন এবং কোথাও সংরক্ষণ করুন।

---

## ধাপ ৪ — অ্যাপ Clone ও Install

```bash
curl -fsSL https://raw.githubusercontent.com/snsbd247/audit-treasure-6d69be20/main/deploy/vps/clone.sh -o /tmp/clone.sh \
  && chmod +x /tmp/clone.sh \
  && sudo REPO_URL=https://github.com/snsbd247/audit-treasure-6d69be20.git \
          APP_DIR=/opt/smarterp \
          /tmp/clone.sh
```

⏱️ ৫–১০ মিনিট লাগবে (frontend build + composer install)।

---

## ধাপ ৫ — `.env` কনফিগার করুন

```bash
sudo nano /opt/smarterp/erp-backend/.env
```

নিচের লাইনগুলো খুঁজে এডিট করুন:

```env
APP_NAME=SmartERP
APP_ENV=production
APP_DEBUG=false
APP_URL=https://erp.irlbd.com

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=smarterp
DB_USERNAME=smarterp
DB_PASSWORD=StrongPass@2026
```

সেভ করুন: `Ctrl+O` → `Enter` → `Ctrl+X`

তারপর:
```bash
cd /opt/smarterp/erp-backend
sudo php artisan key:generate --force
sudo php artisan migrate --seed --force
sudo php artisan config:cache
sudo chown -R www-data:www-data storage bootstrap/cache public
```

---

## ধাপ ৬ — Nginx সাইট কনফিগ করুন

```bash
sudo tee /etc/nginx/sites-available/smarterp > /dev/null <<'NGINX'
server {
    listen 80;
    server_name erp.irlbd.com;
    root /opt/smarterp/erp-backend/public;
    index index.php index.html;

    client_max_body_size 64M;
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.2-fpm.sock;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout 300;
    }

    location ~ /\.(?!well-known).* { deny all; }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/smarterp /etc/nginx/sites-enabled/smarterp
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

এখন browser-এ যান: **http://erp.irlbd.com** — লগইন পেজ আসবে ✅

---

## ধাপ ৭ — SSL (HTTPS) ইনস্টল করুন (ফ্রি, Let's Encrypt)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d erp.irlbd.com --non-interactive --agree-tos -m admin@irlbd.com --redirect
```

এখন site চলবে: **https://erp.irlbd.com** 🔒

Auto-renew check:
```bash
sudo certbot renew --dry-run
```

---

## ধাপ ৮ — প্রথম লগইন

URL: **https://erp.irlbd.com**

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `Admin@123` |

লগইন করেই **Profile → Change Password** থেকে পাসওয়ার্ড বদলে নিন।

---

## 🔄 ভবিষ্যতে আপডেট কীভাবে করবেন

GitHub-এ নতুন কোড push হলে শুধু একটি কমান্ড:

```bash
sudo APP_DIR=/opt/smarterp /opt/smarterp/deploy/vps/update.sh
```

বা ERP-র ভিতরে **Admin → GitHub Deploy Sync → Pull & Deploy** চাপুন।

✅ এটি **পুরোনো ডাটা ডিলিট করে না**, শুধু কোড ও schema additive ভাবে আপডেট হয়।
✅ Migration চালানোর আগে automatic database backup নেয় (`/var/backups/smarterp/`)।

---

## 🆘 সমস্যা হলে চেক করুন

| সমস্যা | কমান্ড |
|---|---|
| সাইট খুলছে না | `sudo systemctl status nginx` |
| 502 Bad Gateway | `sudo systemctl status php8.2-fpm` |
| DB error | `sudo tail -50 /opt/smarterp/erp-backend/storage/logs/laravel.log` |
| Nginx error | `sudo tail -50 /var/log/nginx/error.log` |
| Restart সব | `sudo systemctl restart nginx php8.2-fpm mysql` |

---

## 📦 Backup ফাইল কোথায় থাকে

```bash
ls -lh /var/backups/smarterp/
```

ম্যানুয়াল backup নিতে:
```bash
sudo mysqldump -u smarterp -p smarterp | gzip > ~/smarterp-$(date +%F).sql.gz
```

---

**শুভ কামনা! 🎉**  সমস্যা হলে error log-সহ জানান।
