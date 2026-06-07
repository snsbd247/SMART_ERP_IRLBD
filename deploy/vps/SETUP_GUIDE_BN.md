# 🚀 SmartERP — VPS Setup Guide (erp.irlbd.com)

## 🌐 ডোমেইন স্ট্র্যাটেজি (গুরুত্বপূর্ণ)

এই প্রজেক্টের **দুইটা সম্পূর্ণ আলাদা environment** আছে — এদের মধ্যে কোন backend শেয়ার নেই:

| Environment | Domain | Backend | Database |
|---|---|---|---|
| **Lovable Preview / Demo** | `accounting.syncsolutionbd.com`, `audit-treasure.lovable.app`, `*.lovable.app/dev` | Cloud Supabase (edge functions) | Cloud Supabase Postgres |
| **VPS Production** | `erp.irlbd.com` | Laravel API (`/api`, same-origin) | VPS MySQL (`smarterp`) |

Frontend code (`src/lib/laravel-auth.ts`) hostname দেখে নিজে থেকেই সঠিক backend বেছে নেয় — VPS-এ deploy করতে গেলে আপনাকে কিছু override করতে হবে না। **VPS এ Cloud Supabase কখনো call হয় না**, Lovable preview-তে Laravel API কখনো call হয় না।

---

আপনার সার্ভার তথ্য:

| বিষয় | মান |
|---|---|
| Domain | `erp.irlbd.com` |
| Server IP | `163.227.239.159` |
| GitHub Repo | `https://github.com/snsbd247/audit-treasure-6d69be20.git` |
| App folder | `/opt/smarterp` |
| DB / User / Pass | `smarterp` / `smarterp` / `StrongPass@2026` |
| Admin login | `admin / Admin@123` (প্রথম login-এর পরেই পাল্টে নিন) |

---

## ধাপ ০ — DNS সেট করুন (সবচেয়ে আগে, বাধ্যতামূলক)

আপনার ডোমেইন প্রোভাইডারে গিয়ে এই রেকর্ড যোগ করুন:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `erp` | `163.227.239.159` | 3600 |

✅ Verify:
```bash
ping erp.irlbd.com
```
উত্তরে `163.227.239.159` আসলে DNS ঠিক আছে। (Propagation-এ ৫–৩০ মিনিট লাগতে পারে। SSL ধাপ কাজ করার জন্য DNS ready থাকা জরুরি।)

---

## ধাপ ১ — VPS-এ লগইন

```bash
ssh root@163.227.239.159
```

---

## ধাপ ২ — One-Command Full Install 🎉

নিচের **একটি কমান্ড** কপি করে paste করুন — এটি একসাথে করবে:

1. Base setup (Nginx + PHP 8.2 + MySQL + Node 20 + Composer)
2. MySQL ডাটাবেজ + ইউজার তৈরি
3. GitHub থেকে কোড clone + frontend build + composer install
4. `.env` কনফিগ + `key:generate` + `migrate --seed`
5. Nginx vhost তৈরি + reload
6. SSL সার্টিফিকেট (Let's Encrypt) ইনস্টল + HTTPS redirect

```bash
curl -fsSL https://raw.githubusercontent.com/snsbd247/audit-treasure-6d69be20/main/deploy/vps/quick-install.sh -o /tmp/qi.sh \
  && chmod +x /tmp/qi.sh \
  && sudo DOMAIN=erp.irlbd.com \
          ADMIN_EMAIL=admin@irlbd.com \
          DB_PASS='StrongPass@2026' \
          /tmp/qi.sh
```

⏱️ মোট সময়: **১০–২০ মিনিট** (ইন্টারনেট স্পিড অনুযায়ী)।

> 🔒 **DB_PASS** বদলে নিজের শক্তিশালী পাসওয়ার্ড দিন — পরে `/root/smarterp-credentials.txt` ফাইলে সংরক্ষিত থাকবে।

> 💡 যদি DNS এখনো propagate না হয়ে থাকে, SSL স্কিপ করতে `SKIP_SSL=1` যোগ করুন। পরে চালান: `sudo certbot --nginx -d erp.irlbd.com`

শেষে দেখাবে:
```
✅ All done!  Open:  https://erp.irlbd.com
```

---

## ধাপ ৩ — প্রথম লগইন

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

✅ **পুরোনো ডাটা ডিলিট হয় না** — শুধু কোড ও schema additive ভাবে আপডেট হয়।
✅ Migration চালানোর আগে automatic database backup নেয় (`/var/backups/smarterp/`)।

---

## 🆘 সমস্যা হলে চেক করুন

| সমস্যা | কমান্ড |
|---|---|
| Credentials দেখুন | `sudo cat /root/smarterp-credentials.txt` |
| সাইট খুলছে না | `sudo systemctl status nginx` |
| 502 Bad Gateway | `sudo systemctl status php8.2-fpm` |
| DB / app error | `sudo tail -50 /opt/smarterp/erp-backend/storage/logs/laravel.log` |
| Nginx error | `sudo tail -50 /var/log/nginx/error.log` |
| Restart সব | `sudo systemctl restart nginx php8.2-fpm mysql` |
| SSL আবার চালান | `sudo certbot --nginx -d erp.irlbd.com` |

---

## 📦 Backup

```bash
ls -lh /var/backups/smarterp/                                 # auto backups
sudo mysqldump -u smarterp -p smarterp | gzip > ~/smarterp-$(date +%F).sql.gz  # manual
```

---

## ⚙️ চাইলে ধাপ ধাপে চালাতে চান?

`quick-install.sh` যা করে, সেগুলো আলাদা আলাদা স্ক্রিপ্টেও আছে:

| ধাপ | স্ক্রিপ্ট |
|---|---|
| Base প্যাকেজ | `deploy/vps/setup.sh` |
| Clone + build | `deploy/vps/clone.sh` |
| পরবর্তী আপডেট | `deploy/vps/update.sh` |

কিন্তু সাধারণ ব্যবহারে শুধু **ধাপ ২-এর এক কমান্ড**ই যথেষ্ট।

---

**শুভ কামনা! 🎉**  সমস্যা হলে error log-সহ জানান।
