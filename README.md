# SmartCook Backend API

Backend server untuk aplikasi SmartCook - asisten memasak pintar berbasis AI.

Dibangun dengan Node.js, Express, MongoDB (primary), MySQL (offline backup), dan Gemini AI.

---

## Arsitektur

```
Flutter App
    |
    | HTTP + API Key + JWT
    v
Express Server (server.js)
    |
    |--- MongoDB (Primary Storage - Cloud)
    |       |
    |       |<-- Sync --> MySQL (Offline Backup - Local)
    |
    |--- Gemini AI (Chat Bot)
```

### Flow Data

1. Semua operasi write masuk ke MySQL terlebih dahulu
2. Perubahan di-queue di tabel `sync_queue`
3. Background sync service push data ke MongoDB secara periodik
4. Operasi read mengambil dari MySQL cache, fallback ke MongoDB jika kosong

---

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express 5
- **Database Primary**: MongoDB (Mongoose ODM)
- **Database Backup**: MySQL (mysql2)
- **AI**: Google Gemini AI
- **Auth**: JWT + Firebase Admin SDK
- **Email**: Nodemailer (SMTP)
- **Security**: Helmet, CORS, Rate Limiting, API Key

---

## Struktur Folder

```
smartcook-backend/
├── server.js
├── package.json
├── .env.example
├── .gitignore
│
└── src/
    ├── config/
    │   ├── db.js            (MongoDB + MySQL setup)
    │   ├── firebase.js      (Firebase Admin SDK)
    │   └── gemini.js        (Gemini AI client)
    │
    ├── middleware/
    │   ├── auth.js           (JWT authentication)
    │   ├── apiKey.js         (API key validation)
    │   └── errorHandler.js   (Error handling)
    │
    ├── models/
    │   ├── User.js
    │   ├── Recipe.js
    │   ├── Ingredient.js
    │   ├── FridgeItem.js
    │   ├── Favorite.js
    │   └── ChatHistory.js
    │
    ├── controllers/
    │   ├── authController.js
    │   ├── userController.js
    │   ├── recipeController.js
    │   ├── fridgeController.js
    │   ├── favoriteController.js
    │   ├── chatController.js
    │   ├── categoryController.js
    │   └── syncController.js
    │
    ├── routes/
    │   ├── auth.js
    │   ├── user.js
    │   ├── recipe.js
    │   ├── fridge.js
    │   ├── favorite.js
    │   ├── chat.js
    │   ├── category.js
    │   └── sync.js
    │
    ├── mysql/
    │   └── offline.js        (MySQL CRUD operations)
    │
    ├── utils/
    │   ├── otp.js
    │   ├── email.js
    │   └── syncService.js
    │
    └── seed.js
```

---

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Konfigurasi Environment

Copy `.env.example` ke `.env` dan isi semua value:

```bash
cp .env.example .env
```

### 3. Setup MySQL

Buat database MySQL:

```sql
CREATE DATABASE smartcook;
```

Tabel akan dibuat otomatis saat server pertama kali jalan.

### 4. Setup MongoDB

Gunakan MongoDB Atlas atau MongoDB lokal. Pastikan connection string di `.env` sudah benar.

### 5. Jalankan Server

Development:
```bash
npm run dev
```

Production:
```bash
npm start
```

### 6. Seed Data (Opsional)

```bash
npm run seed
```

---

## Environment Variables

| Variable | Deskripsi | Contoh |
|---|---|---|
| PORT | Port server | 3000 |
| NODE_ENV | Environment | development |
| MONGODB_URI | MongoDB connection string | mongodb+srv://... |
| MYSQL_HOST | MySQL host | localhost |
| MYSQL_PORT | MySQL port | 3306 |
| MYSQL_USER | MySQL username | root |
| MYSQL_PASSWORD | MySQL password | |
| MYSQL_DATABASE | MySQL database name | smartcook |
| JWT_SECRET | Secret key untuk JWT | random_string |
| JWT_EXPIRES_IN | JWT expiry | 7d |
| API_KEY | API key untuk proteksi endpoint | random_string |
| SYNC_INTERVAL | Interval sync MySQL-MongoDB (ms) | 30000 |
| FIREBASE_PROJECT_ID | Firebase project ID | auth-48b22 |
| FIREBASE_CLIENT_EMAIL | Firebase service account email | |
| FIREBASE_PRIVATE_KEY | Firebase private key | |
| GEMINI_API_KEY | Google Gemini API key | |
| SMTP_HOST | SMTP host | smtp.gmail.com |
| SMTP_PORT | SMTP port | 587 |
| SMTP_USER | SMTP username/email | |
| SMTP_PASS | SMTP password/app password | |
| SMTP_FROM | Sender email | SmartCook <noreply@smartcook.com> |

---

## API Endpoints

Semua endpoint memerlukan header `x-api-key` (jika API_KEY di-set di .env).

Endpoint yang memerlukan autentikasi ditandai dengan (Auth) dan memerlukan header `Authorization: Bearer <token>`.

### Health Check

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | /api/health | Cek status server |

### Authentication

| Method | Endpoint | Deskripsi |
|---|---|---|
| POST | /api/auth/register | Register dengan email/password |
| POST | /api/auth/login | Login dengan email/password |
| POST | /api/auth/google | Login dengan Google (Firebase ID token) |
| POST | /api/auth/forgot-password | Kirim OTP ke email |
| POST | /api/auth/verify-otp | Verifikasi kode OTP |
| POST | /api/auth/reset-password | Reset password dengan OTP |

### User (Auth)

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | /api/user/profile | Ambil profil user |
| PUT | /api/user/profile | Update profil user |
| PUT | /api/user/onboarding | Simpan data onboarding |

### Recipes

| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| GET | /api/recipes | - | List resep (pagination, filter) |
| GET | /api/recipes/search?q= | - | Cari resep |
| GET | /api/recipes/recommendations | Auth | Rekomendasi berdasarkan kulkas |
| GET | /api/recipes/by-meal/:type | - | Filter berdasarkan meal type |
| GET | /api/recipes/:id | - | Detail resep |

### Fridge (Auth)

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | /api/fridge | List bahan di kulkas |
| POST | /api/fridge | Tambah bahan ke kulkas |
| PUT | /api/fridge/:id | Update bahan |
| DELETE | /api/fridge/:id | Hapus bahan |
| GET | /api/fridge/by-category/:category | Filter berdasarkan kategori |

### Favorites (Auth)

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | /api/favorites | List resep favorit (pagination) |
| POST | /api/favorites/:recipeId | Tambah ke favorit |
| DELETE | /api/favorites/:recipeId | Hapus dari favorit |

### Chat (Auth)

| Method | Endpoint | Deskripsi |
|---|---|---|
| POST | /api/chat/message | Kirim pesan ke AI chatbot |
| GET | /api/chat/history | Ambil riwayat chat |
| DELETE | /api/chat/history | Hapus riwayat chat |

### Categories

| Method | Endpoint | Deskripsi |
|---|---|---|
| GET | /api/categories/cooking-styles | List gaya masak |
| GET | /api/categories/meal-types | List tipe meal |
| GET | /api/categories/ingredients | List ingredients (filter: ?category=) |

### Sync (Auth)

| Method | Endpoint | Deskripsi |
|---|---|---|
| POST | /api/sync/pull | Pull data dari MongoDB ke MySQL |
| POST | /api/sync/push | Push data dari MySQL ke MongoDB |
| GET | /api/sync/status | Cek status sync |

---

## Database Schema

### MongoDB Collections

#### Users
| Field | Type | Deskripsi |
|---|---|---|
| email | String | Email user (unique) |
| password | String | Password hash (select: false) |
| name | String | Nama user |
| auth_provider | String | "email" atau "google" |
| firebase_uid | String | Firebase UID |
| age_range | String | "< 12 thn", "12 - 17 thn", "> 17 thn" |
| gender | String | "Laki-laki" atau "Perempuan" |
| allergies | [String] | Daftar alergi |
| medical_history | [String] | Riwayat penyakit |
| cooking_styles | [String] | Gaya masak favorit |
| equipment | [String] | Peralatan dapur |
| onboarding_completed | Boolean | Status onboarding |

#### Recipes
| Field | Type | Deskripsi |
|---|---|---|
| title | String | Judul resep |
| description | String | Deskripsi |
| image_url | String | URL gambar |
| ingredients | Array | [{name, quantity, unit}] |
| steps | Array | [{order, instruction}] |
| category | String | Kategori resep |
| meal_type | [String] | breakfast, lunch, dinner |
| tags | [String] | Tag resep |
| prep_time | Number | Waktu persiapan (menit) |
| cook_time | Number | Waktu memasak (menit) |
| servings | Number | Porsi |
| nutrition_info | Object | {calories, protein, carbs, fat} |

#### FridgeItems
| Field | Type | Deskripsi |
|---|---|---|
| user_id | ObjectId | Ref ke User |
| ingredient_name | String | Nama bahan |
| category | String | protein, karbo, sayur, bumbu |
| quantity | Number | Jumlah |
| unit | String | Satuan |
| expired_date | Date | Tanggal kadaluarsa |

#### Ingredients (Master Data)
| Field | Type | Deskripsi |
|---|---|---|
| name | String | Nama bahan |
| category | String | protein, karbo, sayur, bumbu |
| sub_category | String | Sub kategori |
| unit | String | Satuan default |
| common_quantity | Number | Kuantitas umum |

### MySQL Tables (Offline Backup)

- **cached_recipes** - Cache resep dari MongoDB
- **cached_ingredients** - Cache ingredients master data
- **fridge_items** - Inventory kulkas user
- **favorites** - Resep favorit user
- **chat_histories** - Riwayat percakapan AI
- **sync_queue** - Antrian sync ke MongoDB

---

## Request & Response Examples

### Register

```bash
POST /api/auth/register
Content-Type: application/json
x-api-key: your_api_key

{
  "name": "Adam",
  "email": "adam@example.com",
  "password": "password123"
}
```

Response:
```json
{
  "success": true,
  "message": "Registrasi berhasil.",
  "data": {
    "user": { "_id": "...", "name": "Adam", "email": "adam@example.com" },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### Login

```bash
POST /api/auth/login
Content-Type: application/json
x-api-key: your_api_key

{
  "email": "adam@example.com",
  "password": "password123"
}
```

### Google Login

```bash
POST /api/auth/google
Content-Type: application/json
x-api-key: your_api_key

{
  "id_token": "firebase_id_token_here"
}
```

### Save Onboarding

```bash
PUT /api/user/onboarding
Content-Type: application/json
Authorization: Bearer <token>
x-api-key: your_api_key

{
  "name": "Adam",
  "age_range": "12 - 17 thn",
  "gender": "Laki-laki",
  "allergies": ["Kacang", "Susu"],
  "medical_history": ["Diabetes"],
  "cooking_styles": ["Quick & Easy", "Healthy & Clean", "Budget Friendly"],
  "equipment": ["Kompor", "Rice Cooker", "Blender"]
}
```

### Add Fridge Item

```bash
POST /api/fridge
Content-Type: application/json
Authorization: Bearer <token>
x-api-key: your_api_key

{
  "ingredient_name": "Dada ayam",
  "category": "protein",
  "quantity": 500,
  "unit": "gram",
  "expired_date": "2026-02-25T00:00:00.000Z"
}
```

### Send Chat Message

```bash
POST /api/chat/message
Content-Type: application/json
Authorization: Bearer <token>
x-api-key: your_api_key

{
  "message": "Saya punya ayam dan wortel di kulkas. Resep apa yang bisa saya buat?"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "reply": "Dengan ayam dan wortel, kamu bisa membuat...",
    "timestamp": "2026-02-17T00:00:00.000Z"
  }
}
```

---

## Security

- **API Key**: Semua endpoint `/api/*` dilindungi API key via header `x-api-key`
- **JWT Auth**: Endpoint yang memerlukan login menggunakan Bearer token
- **Password Hashing**: bcrypt dengan 12 salt rounds
- **Rate Limiting**: 100 request/15 menit (umum), 20 request/menit (chat)
- **Helmet**: Security headers
- **CORS**: Enabled untuk semua origin

---

## Cooking Styles

| ID | Nama |
|---|---|
| quick_easy | Quick & Easy |
| healthy_clean | Healthy & Clean |
| budget_friendly | Budget Friendly |
| indonesian_comfort | Indonesian Comfort |
| western_vibes | Western Vibes |
| pro_chef | Pro Chef |
| plant_based | Plant Based |
| balanced_nutrition | Balanced Nutrition |

---

## Ingredient Categories

| Category | Sub Categories |
|---|---|
| protein | Protein Hewani, Protein Seafood, Protein Nabati |
| karbo | Karbohidrat |
| sayur | Sayur-Mayur |
| bumbu | Bumbu Dapur |

---

## Scripts

```bash
npm start        # Jalankan server (production)
npm run dev      # Jalankan server (development, auto-reload)
npm run seed     # Seed database dengan data awal
```
