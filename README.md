# SmartCook Backend API

Backend server untuk aplikasi SmartCook - asisten memasak pintar berbasis AI yang membantu pengguna menemukan resep berdasarkan bahan yang tersedia, preferensi kesehatan, dan interaksi dengan AI chatbot.

Dibangun dengan Node.js, Express 5, MongoDB, dan Google Gemini AI.

## 📋 Tentang Backend

SmartCook Backend adalah RESTful API yang menyediakan berbagai endpoint untuk:
- Autentikasi dan manajemen pengguna
- Manajemen resep masakan dengan pencarian dan filtering
- Manajemen bahan makanan di kulkas (fridge)
- Sistem favorit resep
- AI Chat Bot untuk interaksi resep yang lebih interaktif
- Integrasi dengan Google Gemini AI untuk rekomendasi resep
- Pencarian gambar resep menggunakan Openverse API

## 🏗 Arsitektur

```
Flutter App (Frontend)
    |
    | HTTP + API Key + JWT Token
    ↓
Express Server (server.js)
    |
    ├─── MongoDB (Database)
    │    ├── Users
    │    ├── Recipes
    │    ├── FridgeItems
    │    ├── Favorites
    │    ├── ChatHistory
    │    └── Ingredients
    │
    ├─── Firebase Admin SDK (Google Auth Verification)
    │
    ├─── Google Gemini AI (Chat Bot & Recipe Generation)
    │
    └─── Openverse API (Image Search)
```

## 🔄 Alur Request Processing

Setiap request yang masuk ke backend akan melalui alur berikut:

```
Client Request (Flutter App)
    ↓
[API Key Validation] (middleware/apiKey.js)
    ├─→ Invalid → 403 Forbidden
    └─→ Valid → Continue
    ↓
[Rate Limiting] (express-rate-limit)
    ├─→ Limit Exceeded → 429 Too Many Requests
    └─→ Within Limit → Continue
    ↓
[Route Handler] (routes/*.js)
    ↓
[Authentication Middleware] (jika diperlukan - middleware/auth.js)
    ├─→ No Token → 401 Unauthorized
    ├─→ Invalid Token → 401 Unauthorized
    └─→ Valid Token → Attach User to Request
    ↓
[Controller] (controllers/*.js)
    ├─→ Validate Input
    ├─→ Business Logic Processing
    ├─→ Database Query (MongoDB via Mongoose)
    ├─→ AI Processing (jika diperlukan - Gemini AI)
    └─→ Image Search (jika diperlukan - Openverse API)
    ↓
[Error Handler] (middleware/errorHandler.js)
    ├─→ Error → Format Error Response
    └─→ Success → Format Success Response
    ↓
[Response] (JSON)
```

## ✨ Fitur Utama Backend

### 🔐 Authentication & Authorization
- **Register**: Registrasi pengguna baru dengan email/password
- **Login**: Login dengan email/password atau Google Sign-In
- **Forgot Password**: Sistem reset password menggunakan OTP via email
- **JWT Authentication**: Token-based authentication untuk akses API
- **Firebase Integration**: Verifikasi Google Sign-In menggunakan Firebase Admin SDK

### 👤 User Management
- **Profile Management**: CRUD profil pengguna
- **Onboarding Data**: Simpan data onboarding (alergi, riwayat medis, preferensi masak)
- **User Preferences**: Kelola preferensi pengguna untuk rekomendasi resep

### 📖 Recipe Management
- **CRUD Resep**: Create, Read, Update, Delete resep masakan
- **Search**: Pencarian resep berdasarkan keyword
- **Filtering**: Filter resep berdasarkan kategori, meal type, tags
- **Recommendations**: Rekomendasi resep berdasarkan bahan di kulkas dan preferensi pengguna
- **Popular Recipes**: Resep populer berdasarkan jumlah views
- **By Meal Type**: Filter resep berdasarkan waktu makan (breakfast, lunch, dinner)

### 🧊 Fridge Management
- **CRUD Bahan**: Tambah, lihat, update, hapus bahan makanan di kulkas
- **Category Filter**: Filter bahan berdasarkan kategori (protein, karbo, sayur, bumbu)
- **Expiry Tracking**: Tracking tanggal kadaluarsa bahan makanan
- **Integration dengan Recipe**: Rekomendasi resep berdasarkan bahan yang tersedia

### ⭐ Favorites Management
- **Add/Remove Favorite**: Tambah atau hapus resep dari favorit
- **List Favorites**: Daftar semua resep favorit dengan pagination
- **User-specific**: Setiap user memiliki daftar favorit sendiri

### 🤖 AI Chat Bot
- **Chat dengan AI**: Interaksi dengan Google Gemini AI untuk rekomendasi resep
- **Context-aware**: Chat bot memahami konteks user (alergi, bahan di kulkas, preferensi)
- **Recipe Embeds**: AI dapat mengembalikan resep dalam format terstruktur
- **Streaming Response**: Dukungan streaming response untuk pengalaman real-time
- **Chat History**: Riwayat chat tersimpan untuk konteks percakapan
- **Image Search**: Otomatis mencari gambar resep menggunakan Openverse API

### 📂 Categories & Ingredients
- **Cooking Styles**: Master data gaya masak (Quick & Easy, Healthy & Clean, dll)
- **Meal Types**: Master data tipe meal (breakfast, lunch, dinner)
- **Ingredients Master Data**: Daftar lengkap bahan makanan dengan kategori
- **Ingredient Search**: Pencarian bahan makanan

## 🛠 Tech Stack

### Runtime & Framework
- **Node.js**: Runtime environment
- **Express 5**: Web framework untuk RESTful API

### Database
- **MongoDB**: NoSQL database untuk penyimpanan data
- **Mongoose**: ODM (Object Data Modeling) untuk MongoDB

### Authentication & Security
- **JWT (jsonwebtoken)**: Token-based authentication
- **Firebase Admin SDK**: Verifikasi Google Sign-In
- **bcryptjs**: Password hashing dengan 12 salt rounds
- **Helmet**: Security headers
- **CORS**: Cross-Origin Resource Sharing
- **express-rate-limit**: Rate limiting untuk proteksi API

### AI & External Services
- **Google Gemini AI**: AI untuk chat bot dan rekomendasi resep
- **Openverse API**: Pencarian gambar resep (CC-licensed images)
- **Nodemailer**: Email service untuk OTP dan notifikasi

### Utilities
- **express-validator**: Input validation
- **dotenv**: Environment variables management
- **uuid**: Generate unique identifiers

## 📁 Struktur Proyek

```
smartcook-backend/
├── server.js                    # Entry point aplikasi
├── package.json                 # Dependencies dan scripts
├── .env.example                # Template environment variables
├── .env                        # Environment variables (tidak di-commit)
├── .gitignore                  # Git ignore rules
├── LICENSE                     # License file
│
└── src/
    ├── config/                 # Konfigurasi
    │   ├── db.js              # MongoDB connection
    │   ├── firebase.js        # Firebase Admin SDK setup
    │   ├── gemini.js          # Gemini AI client & API key management
    │   ├── openverseImageSearch.js  # Openverse API config
    │   ├── googleImageSearch.js     # Google Image Search config
    │   └── imageScraper.js          # Image scraper utilities
    │
    ├── middleware/             # Express middleware
    │   ├── auth.js            # JWT authentication middleware
    │   ├── apiKey.js          # API key validation middleware
    │   └── errorHandler.js    # Global error handler
    │
    ├── models/                 # Mongoose models
    │   ├── User.js            # User model
    │   ├── Recipe.js          # Recipe model
    │   ├── Ingredient.js      # Ingredient master data model
    │   ├── FridgeItem.js      # Fridge item model
    │   ├── Favorite.js        # Favorite model
    │   └── ChatHistory.js     # Chat history model
    │
    ├── controllers/            # Business logic controllers
    │   ├── authController.js  # Authentication logic
    │   ├── userController.js  # User management logic
    │   ├── recipeController.js # Recipe CRUD & search logic
    │   ├── fridgeController.js # Fridge management logic
    │   ├── favoriteController.js # Favorite management logic
    │   ├── chatController.js  # AI chat bot logic
    │   ├── categoryController.js # Category master data logic
    │   └── ingredientController.js # Ingredient master data logic
    │
    ├── routes/                 # Express routes
    │   ├── auth.js            # Authentication routes
    │   ├── user.js            # User routes
    │   ├── recipe.js          # Recipe routes
    │   ├── fridge.js          # Fridge routes
    │   ├── favorite.js        # Favorite routes
    │   ├── chat.js            # Chat routes
    │   ├── category.js        # Category routes
    │   └── ingredient.js      # Ingredient routes
    │
    ├── services/               # External services
    │   └── imageSearchService.js # Image search service (Openverse)
    │
    ├── utils/                  # Utility functions
    │   ├── otp.js             # OTP generation & validation
    │   ├── email.js           # Email sending utilities
    │   ├── logger.js           # Logging utilities
    │   └── jsonStateStore.js  # JSON state storage untuk API keys
    │
    └── seed.js                 # Database seeding script
```

## 🔐 Alur Authentication

### Register dengan Email/Password

```
POST /api/auth/register
    ↓
[Validate Input] (email, password, name)
    ↓
[Check Email Already Exists]
    ├─→ Exists → 400 Bad Request
    └─→ Not Exists → Continue
    ↓
[Hash Password] (bcrypt, 12 rounds)
    ↓
[Create User] (MongoDB)
    ↓
[Generate JWT Token]
    ↓
[Return User Data + Token]
```

### Login dengan Email/Password

```
POST /api/auth/login
    ↓
[Validate Input] (email, password)
    ↓
[Find User by Email]
    ├─→ Not Found → 401 Unauthorized
    └─→ Found → Continue
    ↓
[Compare Password] (bcrypt)
    ├─→ Mismatch → 401 Unauthorized
    └─→ Match → Continue
    ↓
[Generate JWT Token]
    ↓
[Log Login Event]
    ↓
[Return User Data + Token]
```

### Login dengan Google

```
POST /api/auth/google
    ↓
[Validate Firebase ID Token]
    ↓
[Verify Token dengan Firebase Admin SDK]
    ├─→ Invalid → 401 Unauthorized
    └─→ Valid → Continue
    ↓
[Extract User Info] (email, name, firebase_uid)
    ↓
[Find or Create User]
    ├─→ User Exists → Update Firebase UID
    └─→ User Not Exists → Create New User
    ↓
[Generate JWT Token]
    ↓
[Return User Data + Token]
```

### Forgot Password Flow

```
POST /api/auth/forgot-password
    ↓
[Validate Email]
    ↓
[Find User by Email]
    ├─→ Not Found → 404 Not Found
    └─→ Found → Continue
    ↓
[Generate OTP] (6 digit, expires in 10 minutes)
    ↓
[Send OTP via Email] (Nodemailer)
    ↓
[Store OTP in Memory/DB]
    ↓
[Return Success Message]

POST /api/auth/verify-otp
    ↓
[Validate OTP]
    ├─→ Invalid/Expired → 400 Bad Request
    └─→ Valid → Continue
    ↓
[Mark OTP as Used]
    ↓
[Return Success]

POST /api/auth/reset-password
    ↓
[Validate OTP]
    ├─→ Invalid → 400 Bad Request
    └─→ Valid → Continue
    ↓
[Hash New Password] (bcrypt)
    ↓
[Update User Password]
    ↓
[Invalidate OTP]
    ↓
[Return Success]
```

## 🤖 Alur Chat Bot dengan AI

### Standard Chat Message

```
POST /api/chat/message
    ↓
[Authenticate User] (JWT middleware)
    ↓
[Get User Profile] (allergies, medical_history, cooking_styles)
    ↓
[Get User Fridge Items] (bahan yang tersedia)
    ↓
[Build Prompt] (dengan context user)
    ├─→ User allergies
    ├─→ Medical history
    ├─→ Cooking styles
    ├─→ Fridge ingredients
    └─→ User query
    ↓
[Call Gemini AI API]
    ├─→ Error → Retry dengan API key lain (jika ada)
    └─→ Success → Continue
    ↓
[Parse AI Response]
    ├─→ Extract Recipe JSON (jika ada)
    └─→ Extract Text Response
    ↓
[Search Images untuk Recipe] (Openverse API)
    ├─→ Found → Attach Image URL
    └─→ Not Found → Skip
    ↓
[Save Chat History] (MongoDB)
    ├─→ User message
    ├─→ AI response
    └─→ Recipe embeds (jika ada)
    ↓
[Return Response]
    ├─→ Text reply
    ├─→ Recipe embeds (jika ada)
    └─→ Timestamp
```

### Streaming Chat Message

```
POST /api/chat/message-stream
    ↓
[Same as Standard Chat]
    ↓
[Stream Gemini AI Response]
    ├─→ Chunk 1 → Send to Client
    ├─→ Chunk 2 → Send to Client
    └─→ ... (continue streaming)
    ↓
[Finalize Response]
    ↓
[Save Chat History]
```

## 🔒 Security Features

### API Key Protection
- Semua endpoint `/api/*` dilindungi dengan API key via header `x-api-key`
- API key dapat di-disable dengan tidak meng-set `API_KEY` di `.env`
- Validasi dilakukan di middleware sebelum request masuk ke route handler

### JWT Authentication
- Token-based authentication menggunakan JWT
- Token expires dalam 7 hari (dapat dikonfigurasi via `JWT_EXPIRES_IN`)
- Token disimpan di header `Authorization: Bearer <token>`
- Token di-verify di middleware sebelum akses ke protected endpoints

### Password Security
- Password di-hash menggunakan bcrypt dengan 12 salt rounds
- Password tidak pernah dikembalikan dalam response API
- Password field di model User memiliki `select: false` untuk keamanan

### Rate Limiting
- **Umum**: 1000 request per menit untuk semua endpoint
- **Chat**: 20 request per menit untuk endpoint chat (lebih ketat)
- Rate limit info dikembalikan dalam response saat limit tercapai
- Custom handler dengan pesan error yang user-friendly

### Security Headers
- **Helmet**: Menambahkan security headers (X-Content-Type-Options, X-Frame-Options, dll)
- **CORS**: Enabled untuk semua origin (dapat dikonfigurasi lebih ketat untuk production)

### Input Validation
- Menggunakan `express-validator` untuk validasi input
- Sanitization input untuk mencegah injection attacks
- Error handling yang konsisten

## 📊 Database Schema

### Users Collection

| Field | Type | Deskripsi | Index |
|-------|------|-----------|-------|
| `_id` | ObjectId | User ID | Primary |
| `email` | String | Email user (unique, lowercase) | Unique |
| `password` | String | Password hash (select: false) | - |
| `name` | String | Nama user | - |
| `auth_provider` | String | "email" atau "google" | - |
| `firebase_uid` | String | Firebase UID (untuk Google auth) | - |
| `age_range` | String | "< 12 thn", "12 - 17 thn", "> 17 thn" | - |
| `gender` | String | "Laki-laki" atau "Perempuan" | - |
| `allergies` | [String] | Daftar alergi makanan | - |
| `medical_history` | [String] | Riwayat penyakit | - |
| `cooking_styles` | [String] | Gaya masak favorit | - |
| `equipment` | [String] | Peralatan dapur yang dimiliki | - |
| `onboarding_completed` | Boolean | Status onboarding | - |
| `createdAt` | Date | Tanggal dibuat | - |
| `updatedAt` | Date | Tanggal diupdate | - |

### Recipes Collection

| Field | Type | Deskripsi | Index |
|-------|------|-----------|-------|
| `_id` | ObjectId | Recipe ID | Primary |
| `title` | String | Judul resep | Text |
| `description` | String | Deskripsi resep | Text |
| `image_url` | String | URL gambar resep | - |
| `ingredients` | Array | [{name, quantity, unit}] | - |
| `steps` | Array | [{order, instruction}] | - |
| `category` | String | Kategori resep | - |
| `meal_type` | [String] | ["breakfast", "lunch", "dinner"] | - |
| `tags` | [String] | Tag resep | - |
| `prep_time` | Number | Waktu persiapan (menit) | - |
| `cook_time` | Number | Waktu memasak (menit) | - |
| `servings` | Number | Jumlah porsi | - |
| `nutrition_info` | Object | {calories, protein, carbs, fat} | - |
| `popularity_count` | Number | Jumlah views | - |
| `createdAt` | Date | Tanggal dibuat | - |
| `updatedAt` | Date | Tanggal diupdate | - |

### FridgeItems Collection

| Field | Type | Deskripsi | Index |
|-------|------|-----------|-------|
| `_id` | ObjectId | Fridge item ID | Primary |
| `user_id` | ObjectId | Reference ke User | Index |
| `ingredient_name` | String | Nama bahan | - |
| `category` | String | "protein", "karbo", "sayur", "bumbu" | - |
| `quantity` | Number | Jumlah | - |
| `unit` | String | Satuan (gram, kg, buah, dll) | - |
| `expired_date` | Date | Tanggal kadaluarsa | - |
| `createdAt` | Date | Tanggal dibuat | - |
| `updatedAt` | Date | Tanggal diupdate | - |

### Favorites Collection

| Field | Type | Deskripsi | Index |
|-------|------|-----------|-------|
| `_id` | ObjectId | Favorite ID | Primary |
| `user_id` | ObjectId | Reference ke User | Index |
| `recipe_id` | ObjectId | Reference ke Recipe | Index |
| `createdAt` | Date | Tanggal dibuat | - |

**Compound Index**: `{user_id: 1, recipe_id: 1}` untuk memastikan satu user tidak bisa menambahkan resep yang sama dua kali

### ChatHistory Collection

| Field | Type | Deskripsi | Index |
|-------|------|-----------|-------|
| `_id` | ObjectId | Chat message ID | Primary |
| `user_id` | ObjectId | Reference ke User | Index |
| `role` | String | "user" atau "model" | - |
| `content` | String | Isi pesan | - |
| `recipe_embeds` | Array | [{recipe object}] jika ada | - |
| `timestamp` | Date | Waktu pesan | Index |
| `createdAt` | Date | Tanggal dibuat | - |

### Ingredients Collection (Master Data)

| Field | Type | Deskripsi | Index |
|-------|------|-----------|-------|
| `_id` | ObjectId | Ingredient ID | Primary |
| `name` | String | Nama bahan | Text |
| `category` | String | "protein", "karbo", "sayur", "bumbu" | Index |
| `sub_category` | String | Sub kategori | - |
| `unit` | String | Satuan default | - |
| `common_quantity` | Number | Kuantitas umum | - |

## 📡 API Endpoints

Semua endpoint memerlukan header `x-api-key` (jika `API_KEY` di-set di `.env`).

Endpoint yang memerlukan autentikasi ditandai dengan **(Auth)** dan memerlukan header `Authorization: Bearer <token>`.

### Health Check

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/health` | Cek status server dan koneksi database |

### Authentication

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/auth/register` | Register dengan email/password |
| POST | `/api/auth/login` | Login dengan email/password |
| POST | `/api/auth/google` | Login dengan Google (Firebase ID token) |
| POST | `/api/auth/forgot-password` | Kirim OTP ke email |
| POST | `/api/auth/verify-otp` | Verifikasi kode OTP |
| POST | `/api/auth/reset-password` | Reset password dengan OTP |

### User (Auth)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/user/profile` | Ambil profil user |
| PUT | `/api/user/profile` | Update profil user |
| PUT | `/api/user/onboarding` | Simpan data onboarding |

### Recipes

| Method | Endpoint | Auth | Deskripsi |
|--------|----------|------|-----------|
| GET | `/api/recipes` | - | List resep (pagination, filter) |
| GET | `/api/recipes/search?q=` | - | Cari resep berdasarkan keyword |
| GET | `/api/recipes/recommendations` | ✅ | Rekomendasi berdasarkan kulkas dan preferensi |
| GET | `/api/recipes/popular` | - | Resep populer berdasarkan views |
| GET | `/api/recipes/by-meal/:type` | - | Filter berdasarkan meal type (breakfast/lunch/dinner) |
| GET | `/api/recipes/:id` | - | Detail resep |

### Fridge (Auth)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/fridge` | List bahan di kulkas |
| POST | `/api/fridge` | Tambah bahan ke kulkas |
| PUT | `/api/fridge/:id` | Update bahan |
| DELETE | `/api/fridge/:id` | Hapus bahan |
| GET | `/api/fridge/by-category/:category` | Filter berdasarkan kategori |

### Favorites (Auth)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/favorites` | List resep favorit (pagination) |
| POST | `/api/favorites/:recipeId` | Tambah ke favorit |
| DELETE | `/api/favorites/:recipeId` | Hapus dari favorit |

### Chat (Auth)

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/chat/message` | Kirim pesan ke AI chatbot (standard) |
| POST | `/api/chat/message-stream` | Kirim pesan ke AI chatbot (streaming) |
| GET | `/api/chat/history` | Ambil riwayat chat |
| DELETE | `/api/chat/history` | Hapus riwayat chat |

### Categories

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/categories/cooking-styles` | List gaya masak |
| GET | `/api/categories/meal-types` | List tipe meal |
| GET | `/api/categories/ingredients` | List ingredients (filter: `?category=`) |

### Ingredients

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/ingredients` | List semua ingredients (master data) |
| GET | `/api/ingredients/search?q=` | Cari ingredients |

## 🔧 Environment Variables

| Variable | Deskripsi | Contoh | Required |
|----------|-----------|--------|----------|
| `PORT` | Port server | `3000` | No (default: 3000) |
| `NODE_ENV` | Environment | `development` atau `production` | No |
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://...` | ✅ Yes |
| `JWT_SECRET` | Secret key untuk JWT | `random_string` | ✅ Yes |
| `JWT_EXPIRES_IN` | JWT expiry | `7d` | No (default: 7d) |
| `API_KEY` | API key untuk proteksi endpoint | `random_string` | No (optional) |
| `FIREBASE_PROJECT_ID` | Firebase project ID | `auth-48b22` | ✅ Yes (untuk Google auth) |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email | `firebase-adminsdk-...` | ✅ Yes (untuk Google auth) |
| `FIREBASE_PRIVATE_KEY` | Firebase private key | `-----BEGIN PRIVATE KEY-----...` | ✅ Yes (untuk Google auth) |
| `GEMINI_API_KEY` | Google Gemini API key | `AIza...` | ✅ Yes (untuk chat bot) |
| `OPENVERSE_AUTH_TOKEN` | Openverse bearer token | `token_here` | No (untuk image search) |
| `OPENVERSE_CLIENT_ID` | Openverse client ID | `client_id_here` | No (untuk image search) |
| `SMTP_HOST` | SMTP host | `smtp.gmail.com` | ✅ Yes (untuk email) |
| `SMTP_PORT` | SMTP port | `587` | No (default: 587) |
| `SMTP_USER` | SMTP username/email | `your_email@gmail.com` | ✅ Yes (untuk email) |
| `SMTP_PASS` | SMTP password/app password | `app_password` | ✅ Yes (untuk email) |
| `SMTP_FROM` | Sender email | `SmartCook <noreply@smartcook.com>` | No |

## 🚀 Instalasi & Setup

### Prerequisites

- Node.js (v18 atau lebih tinggi)
- npm atau yarn
- MongoDB (Atlas atau lokal)
- Firebase project (untuk Google Sign-In)
- Google Gemini API key
- SMTP credentials (untuk email OTP)
- Openverse API token (opsional, untuk image search)

### Langkah Instalasi

1. **Clone repository**
   ```bash
   git clone <repository-url>
   cd smartcook-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup Environment Variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit file `.env` dan isi semua value yang diperlukan:
   - MongoDB connection string
   - JWT secret (generate random string)
   - API key (generate random string)
   - Firebase credentials
   - Gemini API key
   - SMTP credentials
   - Openverse credentials (opsional)

4. **Setup MongoDB**
   - Gunakan MongoDB Atlas atau MongoDB lokal
   - Pastikan connection string di `.env` sudah benar
   - Database akan dibuat otomatis saat pertama kali connect

5. **Setup Firebase Admin SDK**
   - Buat Firebase project di [Firebase Console](https://console.firebase.google.com/)
   - Generate service account key
   - Copy `project_id`, `client_email`, dan `private_key` ke `.env`
   - **PENTING**: File service account JSON tidak boleh di-commit ke repository

6. **Setup Google Gemini API**
   - Daftar di [Google AI Studio](https://makersuite.google.com/app/apikey)
   - Generate API key
   - Copy ke `GEMINI_API_KEY` di `.env`
   - **Catatan**: Backend mendukung multiple API keys untuk fallback (dapat dikonfigurasi di `src/config/gemini.js`)

7. **Setup Openverse API (Opsional)**
   - Daftar token di [Openverse Dashboard](https://api.openverse.engineering/v1/auth_tokens/register/)
   - Simpan token ke `OPENVERSE_AUTH_TOKEN` di `.env`
   - Client ID opsional untuk identifikasi rate-limit

8. **Setup SMTP untuk Email**
   - Untuk Gmail: Gunakan App Password (bukan password biasa)
   - Generate App Password di [Google Account Settings](https://myaccount.google.com/apppasswords)
   - Copy ke `SMTP_PASS` di `.env`

9. **Jalankan Server**

   Development (dengan auto-reload):
   ```bash
   npm run dev
   ```

   Production:
   ```bash
   npm start
   ```

10. **Seed Database (Opsional)**
    ```bash
    npm run seed
    ```
    
    Script ini akan mengisi database dengan data awal (recipes, ingredients, categories).

### Verifikasi Setup

Setelah server berjalan, test endpoint health check:

```bash
curl http://localhost:3000/api/health
```

Response yang diharapkan:
```json
{
  "success": true,
  "message": "SmartCook API is running",
  "timestamp": "2026-02-18T...",
  "environment": "development",
  "mongodb": "connected"
}
```

## 📝 Request & Response Examples

### Register

**Request:**
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

**Response:**
```json
{
  "success": true,
  "message": "Registrasi berhasil.",
  "data": {
    "user": {
      "_id": "...",
      "name": "Adam",
      "email": "adam@example.com",
      "auth_provider": "email"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### Login

**Request:**
```bash
POST /api/auth/login
Content-Type: application/json
x-api-key: your_api_key

{
  "email": "adam@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login berhasil.",
  "data": {
    "user": {
      "_id": "...",
      "name": "Adam",
      "email": "adam@example.com"
    },
    "token": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### Google Login

**Request:**
```bash
POST /api/auth/google
Content-Type: application/json
x-api-key: your_api_key

{
  "id_token": "firebase_id_token_here"
}
```

### Send Chat Message

**Request:**
```bash
POST /api/chat/message
Content-Type: application/json
Authorization: Bearer <token>
x-api-key: your_api_key

{
  "message": "Saya punya ayam dan wortel di kulkas. Resep apa yang bisa saya buat?"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "reply": "Dengan ayam dan wortel, kamu bisa membuat Ayam Bumbu Rujak yang lezat...",
    "recipe_embeds": [
      {
        "title": "Ayam Bumbu Rujak",
        "description": "...",
        "ingredients": [...],
        "steps": [...]
      }
    ],
    "timestamp": "2026-02-18T00:00:00.000Z"
  }
}
```

### Add Fridge Item

**Request:**
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

## 🧪 Testing & Development

### Scripts yang Tersedia

```bash
npm start        # Jalankan server (production)
npm run dev      # Jalankan server (development, auto-reload dengan --watch)
npm run seed     # Seed database dengan data awal
```

### Development Mode

Development mode menggunakan `node --watch` untuk auto-reload saat file berubah:

```bash
npm run dev
```

Server akan otomatis restart saat ada perubahan di file `.js`.

### Database Seeding

Script `src/seed.js` akan mengisi database dengan:
- Sample recipes
- Master data ingredients
- Categories dan cooking styles

Jalankan sekali setelah setup:

```bash
npm run seed
```

## 🚢 Deployment

### Production Checklist

- [ ] Set `NODE_ENV=production` di `.env`
- [ ] Gunakan MongoDB Atlas (production-ready)
- [ ] Set `API_KEY` yang kuat dan random
- [ ] Set `JWT_SECRET` yang kuat dan random
- [ ] Konfigurasi CORS untuk domain spesifik (jangan `*` untuk production)
- [ ] Setup monitoring dan logging
- [ ] Setup backup database secara berkala
- [ ] Gunakan HTTPS (SSL/TLS)
- [ ] Setup rate limiting yang sesuai dengan traffic
- [ ] Monitor API usage dan costs (Gemini API, Openverse API)

### Environment Variables untuk Production

Pastikan semua environment variables sudah di-set dengan nilai production yang aman.

### Security Best Practices

1. **Jangan commit `.env` file** - Sudah di-ignore oleh `.gitignore`
2. **Gunakan API key yang kuat** - Generate random string yang panjang
3. **Rotate secrets secara berkala** - Ubah JWT_SECRET dan API_KEY secara berkala
4. **Monitor rate limits** - Pantau penggunaan API untuk mencegah abuse
5. **Setup firewall** - Batasi akses ke server hanya dari IP yang dipercaya
6. **Enable MongoDB authentication** - Jangan biarkan database tanpa password
7. **Use connection pooling** - Konfigurasi Mongoose connection pool
8. **Monitor logs** - Setup logging untuk tracking errors dan suspicious activities

## 📚 Cooking Styles

| ID | Nama |
|----|------|
| `quick_easy` | Quick & Easy |
| `healthy_clean` | Healthy & Clean |
| `budget_friendly` | Budget Friendly |
| `indonesian_comfort` | Indonesian Comfort |
| `western_vibes` | Western Vibes |
| `pro_chef` | Pro Chef |
| `plant_based` | Plant Based |
| `balanced_nutrition` | Balanced Nutrition |

## 📦 Ingredient Categories

| Category | Sub Categories |
|----------|----------------|
| `protein` | Protein Hewani, Protein Seafood, Protein Nabati |
| `karbo` | Karbohidrat |
| `sayur` | Sayur-Mayur |
| `bumbu` | Bumbu Dapur |

## 👥 Core Team

Tim **SmartCook** yang membangun proyek ini:

<table>
<tr>
<td align="center">
<img src="https://github.com/faturrahman82.png" width="100px" alt="Maul"/>
<br />
<strong>Maul</strong>
<br />
<sub>💻 <strong>Frontend Flutter Developer</strong></sub>
<br />
<sub>
📱 Flutter Implementation<br/>
🎯 Feature Development<br/>
🔧 Component Building<br/>
📊 State Management<br/>
🧪 Testing & Debugging<br/>
</sub>
<br />
<a href="https://github.com/faturrahman82">GitHub</a>
</td>
<td align="center">
<img src="https://github.com/geraldy-pf.png" width="100px" alt="Geraldy Putra Fazrian"/>
<br />
<strong>Geraldy Putra Fazrian</strong>
<br />
<sub>💻 <strong>Frontend Flutter Developer</strong></sub>
<br />
<sub>
📱 Flutter Implementation<br/>
🎯 Feature Development<br/>
🔧 Component Building<br/>
📊 State Management<br/>
🧪 Testing & Debugging<br/>
</sub>
<br />
<a href="https://github.com/geraldy-pf">GitHub</a>
</td>
<td align="center">
<img src="https://github.com/ChillGuyAdit.png" width="100px" alt="ChillGuyAdit"/>
<br />
<strong>ChillGuyAdit</strong>
<br />
<sub>🎨 <strong>UI/UX Designer</strong></sub>
<br />
<sub>
🎨 Visual Design<br/>
🖼️ Asset Creation<br/>
🎯 Design System<br/>
✨ User Experience<br/>
📐 Layout Design<br/>
</sub>
<br />
<a href="https://github.com/ChillGuyAdit">GitHub</a>
</td>
<td align="center">
<img src="https://github.com/Sadamdi.png" width="100px" alt="Sulthan Adam Rahmadi"/>
<br />
<strong>Sulthan Adam Rahmadi</strong>
<br />
<sub>🚀 <strong>Backend Developer</strong></sub>
<br />
<sub>
⚙️ Backend Server<br/>
🔧 Logic Implementation<br/>
🗄️ Database Design<br/>
🔐 API Development<br/>
🏗️ System Architecture<br/>
</sub>
<br />
<a href="https://github.com/Sadamdi">GitHub</a>
</td>
</tr>
</table>

## 📄 License

MIT License

Copyright (c) 2026 SmartCook Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## 🙏 Acknowledgments

Terima kasih kepada semua kontributor yang telah membantu dalam pengembangan aplikasi SmartCook ini.

---

**SmartCook Backend API** - Powered by Node.js, Express, MongoDB, and Google Gemini AI 🚀
