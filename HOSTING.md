# Panduan Hosting SmartCook Backend di VPS

Panduan lengkap untuk deploy SmartCook Backend API di server VPS pribadi.

---

## Daftar Isi

1. [Persyaratan VPS](#1-persyaratan-vps)
2. [Setup Awal VPS](#2-setup-awal-vps)
3. [Install Node.js](#3-install-nodejs)
4. [Upload Project ke VPS](#4-upload-project-ke-vps)
5. [Konfigurasi Environment](#5-konfigurasi-environment)
6. [Jalankan Server dengan PM2](#6-jalankan-server-dengan-pm2)
7. [Setup Nginx Reverse Proxy](#7-setup-nginx-reverse-proxy)
8. [Buka Port di Firewall](#8-buka-port-di-firewall)
9. [Setup SSL (HTTPS)](#9-setup-ssl-https)
10. [Akses dari Flutter App](#10-akses-dari-flutter-app)
11. [Monitoring & Maintenance](#11-monitoring--maintenance)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Persyaratan VPS

| Kebutuhan | Minimum | Rekomendasi |
|---|---|---|
| OS | Ubuntu 20.04 LTS | Ubuntu 22.04 LTS |
| RAM | 1 GB | 2 GB |
| CPU | 1 vCPU | 2 vCPU |
| Storage | 10 GB | 20 GB |
| Bandwidth | 1 TB/bulan | Unlimited |

Provider VPS yang bisa dipakai: DigitalOcean, Vultr, Linode, AWS Lightsail, Contabo, IDCloudHost, dll.

---

## 2. Setup Awal VPS

Login ke VPS via SSH:

```bash
ssh root@IP_VPS_KAMU
```

Update sistem:

```bash
apt update && apt upgrade -y
```

Buat user baru (jangan pakai root untuk production):

```bash
adduser smartcook
usermod -aG sudo smartcook
su - smartcook
```

---

## 3. Install Node.js

Install Node.js 20 LTS via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verifikasi:

```bash
node --version
npm --version
```

Install PM2 (process manager):

```bash
sudo npm install -g pm2
```

Install build tools (dibutuhkan untuk better-sqlite3):

```bash
sudo apt install -y build-essential python3
```

---

## 4. Upload Project ke VPS

### Opsi A: Via Git (Rekomendasi)

Di VPS:

```bash
cd /home/smartcook
git clone <URL_REPO_KAMU> smartcook-backend
cd smartcook-backend
npm install
```

### Opsi B: Via SCP (Upload manual)

Di komputer lokal:

```bash
scp -r ./smartcook-backend smartcook@IP_VPS_KAMU:/home/smartcook/
```

Di VPS:

```bash
cd /home/smartcook/smartcook-backend
npm install
```

### Opsi C: Via SFTP

Pakai FileZilla atau WinSCP:
- Host: IP VPS kamu
- Username: smartcook
- Password: password kamu
- Port: 22
- Upload folder `smartcook-backend` ke `/home/smartcook/`

---

## 5. Konfigurasi Environment

Buat file `.env`:

```bash
cd /home/smartcook/smartcook-backend
cp .env.example .env
nano .env
```

Isi semua variable:

```
PORT=3000
NODE_ENV=production

MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/smartcook?retryWrites=true&w=majority

JWT_SECRET=BUAT_SECRET_YANG_PANJANG_DAN_RANDOM
JWT_EXPIRES_IN=7d

API_KEY=BUAT_API_KEY_YANG_PANJANG_DAN_RANDOM

SYNC_INTERVAL=30000

FIREBASE_PROJECT_ID=auth-48b22
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@auth-48b22.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nISI_PRIVATE_KEY_KAMU\n-----END PRIVATE KEY-----\n"

GEMINI_API_KEY=API_KEY_GEMINI_KAMU

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=email_kamu@gmail.com
SMTP_PASS=app_password_kamu
SMTP_FROM=SmartCook <noreply@smartcook.com>
```

Untuk generate secret key random:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Seed data awal (opsional):

```bash
npm run seed
```

---

## 6. Jalankan Server dengan PM2

Start server:

```bash
cd /home/smartcook/smartcook-backend
pm2 start server.js --name smartcook-api
```

Set PM2 auto-start saat VPS reboot:

```bash
pm2 startup
pm2 save
```

Perintah PM2 penting:

```bash
pm2 status                  # Lihat status
pm2 logs smartcook-api      # Lihat log
pm2 restart smartcook-api   # Restart
pm2 stop smartcook-api      # Stop
pm2 monit                   # Monitor realtime
```

Test apakah jalan:

```bash
curl http://localhost:3000/api/health
```

---

## 7. Setup Nginx Reverse Proxy

Install Nginx:

```bash
sudo apt install -y nginx
```

Buat konfigurasi:

```bash
sudo nano /etc/nginx/sites-available/smartcook
```

Isi dengan:

```nginx
server {
    listen 80;
    server_name IP_VPS_KAMU;
    # Ganti dengan domain jika ada:
    # server_name api.smartcook.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;

        client_max_body_size 10M;
    }
}
```

Aktifkan konfigurasi:

```bash
sudo ln -s /etc/nginx/sites-available/smartcook /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Sekarang API bisa diakses via: `http://IP_VPS_KAMU/api/health`

---

## 8. Buka Port di Firewall

### UFW (Ubuntu Firewall)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Jika mau akses langsung via port 3000 (tanpa Nginx):

```bash
sudo ufw allow 3000/tcp
```

### Firewall di Panel VPS

Kebanyakan VPS provider punya firewall di dashboard:

**DigitalOcean**:
- Masuk ke Networking > Firewalls
- Buat firewall baru
- Inbound Rules: Allow TCP port 80, 443, 22
- Attach ke droplet kamu

**Vultr**:
- Masuk ke Firewall
- Add Rule: TCP Accept port 80, 443, 22

**AWS Lightsail**:
- Masuk ke Networking tab
- Add Rule: HTTP (80), HTTPS (443), SSH (22)

**Contoh untuk buka port custom**:
Jika ingin expose port 3000 langsung:
- Add Rule: Custom TCP, Port 3000, Source 0.0.0.0/0

### iptables (Manual)

```bash
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
sudo iptables-save | sudo tee /etc/iptables/rules.v4
```

---

## 9. Setup SSL (HTTPS)

### Pakai Domain

Jika punya domain, arahkan DNS A record ke IP VPS:

```
Type: A
Name: api (atau @)
Value: IP_VPS_KAMU
TTL: 300
```

Install Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
```

Generate SSL:

```bash
sudo certbot --nginx -d api.smartcook.com
```

Certbot otomatis update konfigurasi Nginx dan auto-renew SSL.

### Tanpa Domain (Pakai IP langsung)

Untuk development/testing, bisa pakai HTTP biasa: `http://IP_VPS:3000`

Atau pakai self-signed certificate (tidak direkomendasikan untuk production):

```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/smartcook.key \
  -out /etc/ssl/certs/smartcook.crt
```

---

## 10. Akses dari Flutter App

### Base URL di Flutter

Tanpa domain:

```dart
const String baseUrl = "http://IP_VPS_KAMU:3000/api";
```

Dengan Nginx (port 80):

```dart
const String baseUrl = "http://IP_VPS_KAMU/api";
```

Dengan SSL + domain:

```dart
const String baseUrl = "https://api.smartcook.com/api";
```

### Headers yang wajib dikirim

```dart
Map<String, String> headers = {
  "Content-Type": "application/json",
  "x-api-key": "ISI_API_KEY_KAMU_DISINI",
};
```

Untuk endpoint yang butuh auth, tambahkan:

```dart
headers["Authorization"] = "Bearer $jwtToken";
```

### Contoh request Dart/Flutter

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;

const baseUrl = "https://api.smartcook.com/api";
const apiKey = "ISI_API_KEY_KAMU";

Future<Map<String, dynamic>> login(String email, String password) async {
  final response = await http.post(
    Uri.parse("$baseUrl/auth/login"),
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: jsonEncode({
      "email": email,
      "password": password,
    }),
  );
  return jsonDecode(response.body);
}
```

---

## 11. Monitoring & Maintenance

### Cek status server

```bash
pm2 status
pm2 logs smartcook-api --lines 50
```

### Restart setelah update code

```bash
cd /home/smartcook/smartcook-backend
git pull origin main
npm install
pm2 restart smartcook-api
```

### Backup SQLite database

```bash
cp /home/smartcook/smartcook-backend/src/sqlite/smartcook.db /home/smartcook/backup/smartcook_$(date +%Y%m%d).db
```

### Auto backup via cron

```bash
crontab -e
```

Tambahkan:

```
0 2 * * * cp /home/smartcook/smartcook-backend/src/sqlite/smartcook.db /home/smartcook/backup/smartcook_$(date +\%Y\%m\%d).db
```

### Monitor resource

```bash
htop
pm2 monit
```

---

## 12. Troubleshooting

### Server tidak bisa diakses dari luar

1. Cek server jalan: `pm2 status`
2. Cek port terbuka: `sudo netstat -tlnp | grep 3000`
3. Cek firewall: `sudo ufw status`
4. Cek Nginx: `sudo nginx -t && sudo systemctl status nginx`
5. Cek log: `pm2 logs smartcook-api`

### Error "EADDRINUSE port 3000"

```bash
sudo lsof -i :3000
sudo kill -9 <PID>
pm2 restart smartcook-api
```

### better-sqlite3 build error

```bash
sudo apt install -y build-essential python3
npm rebuild better-sqlite3
```

### MongoDB connection timeout

- Pastikan IP VPS di-whitelist di MongoDB Atlas
  - Atlas > Network Access > Add IP Address > isi IP VPS
- Cek apakah MONGODB_URI di .env benar

### Permission denied

```bash
sudo chown -R smartcook:smartcook /home/smartcook/smartcook-backend
```

### Nginx 502 Bad Gateway

- Server Node.js belum jalan: `pm2 start server.js --name smartcook-api`
- Port salah di Nginx config: pastikan `proxy_pass http://127.0.0.1:3000`

---

## Quick Start (Ringkasan)

```bash
# 1. SSH ke VPS
ssh root@IP_VPS

# 2. Install dependencies
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs build-essential python3 nginx
npm install -g pm2

# 3. Upload dan setup project
cd /home
git clone <REPO_URL> smartcook-backend
cd smartcook-backend
npm install
cp .env.example .env
nano .env  # isi semua variable

# 4. Seed data + jalankan
npm run seed
pm2 start server.js --name smartcook-api
pm2 startup && pm2 save

# 5. Setup Nginx
nano /etc/nginx/sites-available/smartcook  # isi config
ln -s /etc/nginx/sites-available/smartcook /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx

# 6. Buka firewall
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable

# 7. Test
curl http://localhost:3000/api/health
```

Selesai! API kamu sekarang bisa diakses di `http://IP_VPS_KAMU/api/`
