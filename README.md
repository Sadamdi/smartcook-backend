# SmartCook Backend API

Backend API untuk aplikasi SmartCook - asisten memasak pintar berbasis AI.

**Tech Stack**: Node.js, Express.js, MongoDB (online backup), SQLite (primary local storage), Gemini AI, Firebase Admin

**Lihat juga**: [HOSTING.md](HOSTING.md) - Panduan deploy di VPS pribadi

---

## Arsitektur Data: SQLite-First
```
Flutter App
    |
    | (HTTP + API Key + JWT)
    v
[Express Server]
    |
    +--> [SQLite] ---- primary storage
    |         |
    |         +--> [Sync Queue] --> [MongoDB] (backup saat terkoneksi)
    |
    +--> [Gemini AI] (chatbot)
```

---

## Proteksi API Key

Semua endpoint dilindungi oleh API Key. Hanya aplikasi yang memiliki key yang benar yang bisa mengakses API.

Setiap request **wajib** menyertakan header:

```
x-api-key: YOUR_API_KEY_HERE
```

Jika tidak ada atau salah, server akan menolak dengan:

```json
{
  "success": false,
  "message": "Akses ditolak. API key tidak valid."
}
```

---

## Setup & Instalasi

### 1. Install Dependencies

```bash
cd smartcook-backend
npm install
```

### 2. Environment Variables

Salin `.env.example` menjadi `.env` dan isi semua value:

```bash
cp .env.example .env
```

**Environment Variables:**

| Variable | Deskripsi |
|---|---|
| `PORT` | Port server (default: 3000) |
| `NODE_ENV` | `development` atau `production` |
| `MONGODB_URI` | Connection string MongoDB Atlas |
| `JWT_SECRET` | Secret key untuk JWT token |
| `JWT_EXPIRES_IN` | Masa berlaku JWT (contoh: `7d`) |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email |
| `FIREBASE_PRIVATE_KEY` | Firebase private key |
| `API_KEY` | Secret key untuk proteksi endpoint (wajib di production) |
| `SYNC_INTERVAL` | Interval sync SQLite ke MongoDB dalam ms (default: 30000) |
| `GEMINI_API_KEY` | Google Gemini API key |
| `SMTP_HOST` | SMTP host untuk kirim email |
| `SMTP_PORT` | SMTP port (587 untuk TLS) |
| `SMTP_USER` | Email pengirim |
| `SMTP_PASS` | App password email |
| `SMTP_FROM` | Display name pengirim |

### 3. Jalankan Server

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

### 4. Seed Data (Opsional)

Mengisi database dengan data awal (bahan-bahan dan resep contoh):

```bash
npm run seed
```

---

## Base URL

```
http://localhost:3000/api
```

Semua request wajib menyertakan header:

```
x-api-key: YOUR_API_KEY
```

Semua response menggunakan format JSON:

```json
{
  "success": true/false,
  "message": "...",
  "data": { ... }
}
```

---

## Autentikasi

Semua endpoint yang butuh login menggunakan header:

```
Authorization: Bearer <jwt_token>
```

Token didapat dari response endpoint `/api/auth/register`, `/api/auth/login`, `/api/auth/google`, atau `/api/auth/apple`.

---

## API Endpoints

### Health Check

```
GET /api/health
```

Response:

```json
{
  "success": true,
  "message": "SmartCook API is running",
  "timestamp": "2026-02-12T...",
  "environment": "development",
  "mongodb": "connected"
}
```

---

### AUTH - `/api/auth`

#### POST `/api/auth/register`

Daftar akun baru dengan email dan password.

Request Body:

```json
{
  "name": "Adam",
  "email": "adam@email.com",
  "password": "password123"
}
```

Response (201):

```json
{
  "success": true,
  "message": "Registrasi berhasil.",
  "data": {
    "user": {
      "_id": "...",
      "email": "adam@email.com",
      "name": "Adam",
      "auth_provider": "email",
      "allergies": [],
      "medical_history": [],
      "cooking_styles": [],
      "equipment": [],
      "onboarding_completed": false,
      "created_at": "..."
    },
    "token": "eyJhbGciOi..."
  }
}
```

---

#### POST `/api/auth/login`

Login dengan email dan password.

Request Body:

```json
{
  "email": "adam@email.com",
  "password": "password123"
}
```

Response (200):

```json
{
  "success": true,
  "message": "Login berhasil.",
  "data": {
    "user": { ... },
    "token": "eyJhbGciOi..."
  }
}
```

---

#### POST `/api/auth/google`

Login/register via Google. Kirim Firebase ID token dari Google Sign In.

Request Body:

```json
{
  "id_token": "firebase_id_token_dari_google_sign_in"
}
```

Response (200):

```json
{
  "success": true,
  "message": "Login Google berhasil.",
  "data": {
    "user": { ... },
    "token": "eyJhbGciOi..."
  }
}
```

---

#### POST `/api/auth/apple`

Login/register via Apple. Kirim Firebase ID token dari Apple Sign In.

Request Body:

```json
{
  "id_token": "firebase_id_token_dari_apple_sign_in"
}
```

Response (200):

```json
{
  "success": true,
  "message": "Login Apple berhasil.",
  "data": {
    "user": { ... },
    "token": "eyJhbGciOi..."
  }
}
```

---

#### POST `/api/auth/forgot-password`

Kirim kode OTP ke email untuk reset password.

Request Body:

```json
{
  "email": "adam@email.com"
}
```

Response (200):

```json
{
  "success": true,
  "message": "Kode OTP telah dikirim ke email kamu."
}
```

---

#### POST `/api/auth/verify-otp`

Verifikasi kode OTP yang dikirim ke email.

Request Body:

```json
{
  "email": "adam@email.com",
  "otp": "1234"
}
```

Response (200):

```json
{
  "success": true,
  "message": "OTP terverifikasi."
}
```

---

#### POST `/api/auth/reset-password`

Reset password dengan OTP yang sudah terverifikasi.

Request Body:

```json
{
  "email": "adam@email.com",
  "otp": "1234",
  "new_password": "newpassword123"
}
```

Response (200):

```json
{
  "success": true,
  "message": "Password berhasil direset."
}
```

---

### USER - `/api/user` (Butuh Auth)

#### GET `/api/user/profile`

Ambil profil user yang sedang login.

Headers: `Authorization: Bearer <token>`

Response (200):

```json
{
  "success": true,
  "data": {
    "_id": "...",
    "email": "adam@email.com",
    "name": "Adam",
    "age_range": "18 - 25 thn",
    "gender": "Laki-Laki",
    "allergies": ["Kacang", "Susu"],
    "medical_history": ["Diabetes"],
    "cooking_styles": ["Quick & Easy", "Healthy & Clean"],
    "equipment": ["Kompor", "Rice Cooker"],
    "onboarding_completed": true
  }
}
```

---

#### PUT `/api/user/profile`

Update profil dasar user.

Headers: `Authorization: Bearer <token>`

Request Body:

```json
{
  "name": "Adam Updated",
  "age_range": "18 - 25 thn",
  "gender": "Laki-Laki"
}
```

Response (200):

```json
{
  "success": true,
  "message": "Profil berhasil diupdate.",
  "data": { ... }
}
```

---

#### PUT `/api/user/onboarding`

Simpan semua data onboarding sekaligus.

Headers: `Authorization: Bearer <token>`

Request Body:

```json
{
  "name": "Adam",
  "age_range": "18 - 25 thn",
  "gender": "Laki-Laki",
  "allergies": ["Kacang", "Telur", "Susu"],
  "medical_history": ["Diabetes", "Kolesterol"],
  "cooking_styles": ["Quick & Easy", "Healthy & Clean"],
  "equipment": ["Kompor", "Rice Cooker", "Blender"]
}
```

Response (200):

```json
{
  "success": true,
  "message": "Data onboarding berhasil disimpan.",
  "data": { ... }
}
```

Value yang valid:

- `age_range`: `"12 - 17 thn"`, `"18 - 25 thn"`, `"26 - 40 thn"`
- `gender`: `"Laki-Laki"`, `"Perempuan"`
- `allergies`: `["Kacang", "Telur", "Susu", "Ikan", "Seafood", "Kedelai", "Gandum", "Susu Sapi"]`
- `medical_history`: `["Diabetes", "Kolesterol", "Asam Urat", "Hipertensi", "Maag / Gerd", "Obesitas", "Intoleransi Laktosa", "Gagal Ginjal"]`
- `cooking_styles`: `["Quick & Easy", "Healthy & Clean", "Budget Friendly", "Traditional", "Modern", "Vegetarian"]`
- `equipment`: `["Kompor", "Rice Cooker", "Oven", "Air Fryer", "Blender"]`

---

### RECIPES - `/api/recipes`

#### GET `/api/recipes`

List semua resep dengan pagination dan filter.

Query Parameters:
- `page` (default: 1)
- `limit` (default: 10)
- `category` - filter by kategori (contoh: `Traditional`, `Quick & Easy`)
- `tags` - filter by tags, comma-separated (contoh: `Diet,Healthy & Clean`)

Response (200):

```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "title": "Jagung Sayur Kentang Bowl",
      "description": "Cocok untuk Diet, Diabetes...",
      "image_url": "",
      "ingredients": [
        { "name": "Jagung", "quantity": "2", "unit": "tongkol" }
      ],
      "steps": [
        { "order": 1, "instruction": "Potong jagung..." }
      ],
      "category": "Healthy & Clean",
      "meal_type": ["lunch", "dinner"],
      "tags": ["Healthy & Clean", "Budget Friendly"],
      "prep_time": 10,
      "cook_time": 20,
      "servings": 2,
      "nutrition_info": { "calories": 250, "protein": 8, "carbs": 45, "fat": 5 }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 8,
    "pages": 1
  }
}
```

---

#### GET `/api/recipes/search`

Pencarian resep berdasarkan keyword.

Query Parameters:
- `q` (wajib) - keyword pencarian
- `page` (default: 1)
- `limit` (default: 10)

Contoh: `GET /api/recipes/search?q=ayam goreng`

---

#### GET `/api/recipes/recommendations` (Butuh Auth)

Rekomendasi resep berdasarkan bahan di kulkas dan preferensi user.

Headers: `Authorization: Bearer <token>`

Query Parameters:
- `limit` (default: 5)

Response (200):

```json
{
  "success": true,
  "data": [ ... ]
}
```

---

#### GET `/api/recipes/by-meal/:type`

Filter resep berdasarkan tipe makan.

Parameter:
- `type`: `breakfast`, `lunch`, atau `dinner`

Query Parameters:
- `page` (default: 1)
- `limit` (default: 10)

Contoh: `GET /api/recipes/by-meal/breakfast`

---

#### GET `/api/recipes/:id`

Detail satu resep.

Contoh: `GET /api/recipes/65abc123def456`

---

### FRIDGE - `/api/fridge` (Butuh Auth)

#### GET `/api/fridge`

List semua bahan di kulkas user.

Headers: `Authorization: Bearer <token>`

Response (200):

```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "ingredient_name": "Ayam",
      "category": "protein",
      "quantity": 500,
      "unit": "gram"
    }
  ]
}
```

---

#### POST `/api/fridge`

Tambah bahan ke kulkas. Jika bahan sudah ada, quantity akan ditambahkan.

Headers: `Authorization: Bearer <token>`

Request Body:

```json
{
  "ingredient_name": "Ayam",
  "category": "protein",
  "quantity": 500,
  "unit": "gram"
}
```

`category` harus salah satu: `"protein"`, `"karbo"`, `"sayur"`, `"bumbu"`

Response (201):

```json
{
  "success": true,
  "message": "Bahan berhasil ditambahkan ke kulkas.",
  "data": { ... }
}
```

---

#### PUT `/api/fridge/:id`

Update jumlah/satuan bahan.

Headers: `Authorization: Bearer <token>`

Request Body:

```json
{
  "quantity": 300,
  "unit": "gram"
}
```

---

#### DELETE `/api/fridge/:id`

Hapus bahan dari kulkas.

Headers: `Authorization: Bearer <token>`

Response (200):

```json
{
  "success": true,
  "message": "Bahan berhasil dihapus dari kulkas."
}
```

---

#### GET `/api/fridge/by-category/:category`

Filter bahan kulkas berdasarkan kategori.

Parameter:
- `category`: `protein`, `karbo`, `sayur`, atau `bumbu`

Contoh: `GET /api/fridge/by-category/protein`

---

### FAVORITES - `/api/favorites` (Butuh Auth)

#### GET `/api/favorites`

List resep favorit user.

Headers: `Authorization: Bearer <token>`

Query Parameters:
- `page` (default: 1)
- `limit` (default: 10)

Response (200):

```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "recipe": {
        "_id": "...",
        "title": "Nasi Goreng Spesial",
        "description": "...",
        "image_url": "..."
      },
      "created_at": "..."
    }
  ],
  "pagination": { ... }
}
```

---

#### POST `/api/favorites/:recipeId`

Tambah resep ke favorit.

Headers: `Authorization: Bearer <token>`

Contoh: `POST /api/favorites/65abc123def456`

Response (201):

```json
{
  "success": true,
  "message": "Resep ditambahkan ke favorit.",
  "data": { ... }
}
```

---

#### DELETE `/api/favorites/:recipeId`

Hapus resep dari favorit.

Headers: `Authorization: Bearer <token>`

Contoh: `DELETE /api/favorites/65abc123def456`

---

### CHAT (Gemini AI) - `/api/chat` (Butuh Auth)

#### POST `/api/chat/message`

Kirim pesan ke chatbot SmartCook (Gemini AI). Chatbot otomatis menerima konteks:
- Profil user (alergi, penyakit, preferensi)
- Isi kulkas user
- Riwayat chat sebelumnya (20 pesan terakhir)

Headers: `Authorization: Bearer <token>`

Request Body:

```json
{
  "message": "Aku punya ayam dan kentang di kulkas, bikin apa ya?"
}
```

Response (200):

```json
{
  "success": true,
  "data": {
    "reply": "Berdasarkan bahan yang kamu punya, aku sarankan membuat **Ayam Goreng Kentang**! Berikut resepnya:\n\n**Bahan:**\n- 300g ayam\n- 200g kentang\n...",
    "timestamp": "2026-02-12T..."
  }
}
```

---

#### GET `/api/chat/history`

Ambil riwayat chat user.

Headers: `Authorization: Bearer <token>`

Response (200):

```json
{
  "success": true,
  "data": {
    "messages": [
      { "role": "user", "content": "Aku punya ayam...", "timestamp": "..." },
      { "role": "model", "content": "Berdasarkan bahan...", "timestamp": "..." }
    ],
    "created_at": "...",
    "updated_at": "..."
  }
}
```

---

#### DELETE `/api/chat/history`

Hapus semua riwayat chat user.

Headers: `Authorization: Bearer <token>`

Response (200):

```json
{
  "success": true,
  "message": "Riwayat chat berhasil dihapus."
}
```

---

### CATEGORIES - `/api/categories`

#### GET `/api/categories/cooking-styles`

List semua gaya masak yang tersedia.

Response (200):

```json
{
  "success": true,
  "data": [
    { "id": "quick_easy", "name": "Quick & Easy", "description": "Masakan cepat dan mudah" },
    { "id": "healthy_clean", "name": "Healthy & Clean", "description": "Masakan sehat dan bersih" },
    { "id": "budget_friendly", "name": "Budget Friendly", "description": "Masakan hemat budget" },
    { "id": "traditional", "name": "Traditional", "description": "Masakan tradisional Indonesia" },
    { "id": "modern", "name": "Modern", "description": "Masakan modern dan kekinian" },
    { "id": "vegetarian", "name": "Vegetarian", "description": "Masakan vegetarian" }
  ]
}
```

---

#### GET `/api/categories/meal-types`

List tipe makan.

Response (200):

```json
{
  "success": true,
  "data": [
    { "id": "breakfast", "name": "Breakfast", "description": "Sarapan pagi" },
    { "id": "lunch", "name": "Lunch", "description": "Makan siang" },
    { "id": "dinner", "name": "Dinner", "description": "Makan malam" }
  ]
}
```

---

#### GET `/api/categories/ingredients`

Master list bahan makanan. Bisa filter per kategori.

Query Parameters:
- `category` (opsional): `protein`, `karbo`, `sayur`, `bumbu`

Contoh: `GET /api/categories/ingredients?category=protein`

Response (200) tanpa filter:

```json
{
  "success": true,
  "data": {
    "categories": [
      { "id": "protein", "name": "Protein", "icon": "protein" },
      { "id": "karbo", "name": "Karbo", "icon": "karbo" },
      { "id": "sayur", "name": "Sayur", "icon": "sayur" },
      { "id": "bumbu", "name": "Bumbu", "icon": "bumbu" }
    ],
    "ingredients": {
      "protein": [
        { "_id": "...", "name": "Ayam", "category": "protein", "sub_category": "Protein Hewani", "unit": "gram", "common_quantity": 250 }
      ],
      "karbo": [ ... ],
      "sayur": [ ... ],
      "bumbu": [ ... ]
    }
  }
}
```

---

### SYNC (Offline) - `/api/sync` (Butuh Auth)

#### POST `/api/sync/pull`

Pull semua data terbaru. Jika MongoDB terkoneksi, tarik dari sana dan cache ke SQLite. Jika tidak, return data dari SQLite.

Headers: `Authorization: Bearer <token>`

Response (200):

```json
{
  "success": true,
  "data": {
    "recipes": [ ... ],
    "ingredients": [ ... ],
    "fridge": [ ... ],
    "favorites": [ ... ]
  },
  "source": "mongodb",
  "synced_at": "2026-02-12T..."
}
```

`source` bisa `"mongodb"` atau `"sqlite"`, menunjukkan dari mana data diambil.

---

#### POST `/api/sync/push`

Trigger sync manual. Push semua pending changes dari SQLite ke MongoDB.

Headers: `Authorization: Bearer <token>`

Response (200):

```json
{
  "success": true,
  "message": "Data berhasil disync ke MongoDB.",
  "pending_sync": 0,
  "synced_at": "..."
}
```

Jika MongoDB tidak tersedia:

```json
{
  "success": true,
  "message": "Data tersimpan di SQLite, akan disync saat MongoDB tersedia.",
  "pending_sync": 5,
  "synced_at": "..."
}
```

---

#### GET `/api/sync/status`

Cek status koneksi MongoDB dan jumlah item yang belum di-sync.

Headers: `Authorization: Bearer <token>`

Response (200):

```json
{
  "success": true,
  "data": {
    "mongodb_connected": true,
    "pending_sync_items": 0,
    "timestamp": "..."
  }
}
```

---

## Database Schema

### MongoDB Collections

**users**

| Field | Type | Keterangan |
|---|---|---|
| email | String | Unique, lowercase |
| password | String | Hashed (bcrypt) |
| name | String | Nama user |
| auth_provider | String | `email`, `google`, `apple` |
| firebase_uid | String | UID dari Firebase |
| age_range | String | `12 - 17 thn`, `18 - 25 thn`, `26 - 40 thn` |
| gender | String | `Laki-Laki`, `Perempuan` |
| allergies | [String] | Daftar alergi |
| medical_history | [String] | Daftar riwayat penyakit |
| cooking_styles | [String] | Daftar gaya masak favorit |
| equipment | [String] | Daftar peralatan dapur |
| onboarding_completed | Boolean | Status onboarding |
| otp_code | String | Kode OTP (sementara) |
| otp_expires | Date | Waktu expired OTP |

**recipes**

| Field | Type | Keterangan |
|---|---|---|
| title | String | Nama resep |
| description | String | Deskripsi singkat |
| image_url | String | URL gambar |
| ingredients | Array | `[{name, quantity, unit}]` |
| steps | Array | `[{order, instruction}]` |
| category | String | Kategori utama |
| meal_type | [String] | `breakfast`, `lunch`, `dinner` |
| tags | [String] | Tag untuk filtering |
| prep_time | Number | Waktu persiapan (menit) |
| cook_time | Number | Waktu masak (menit) |
| servings | Number | Jumlah porsi |
| nutrition_info | Object | `{calories, protein, carbs, fat}` |
| suitable_for | [String] | Cocok untuk kondisi tertentu |
| not_suitable_for | [String] | Tidak cocok untuk kondisi tertentu |

**fridgeitems**

| Field | Type | Keterangan |
|---|---|---|
| user_id | ObjectId | Referensi ke users |
| ingredient_name | String | Nama bahan |
| category | String | `protein`, `karbo`, `sayur`, `bumbu` |
| quantity | Number | Jumlah |
| unit | String | Satuan |

**favorites**

| Field | Type | Keterangan |
|---|---|---|
| user_id | ObjectId | Referensi ke users |
| recipe_id | ObjectId | Referensi ke recipes |

**chathistories**

| Field | Type | Keterangan |
|---|---|---|
| user_id | ObjectId | Referensi ke users |
| messages | Array | `[{role: "user"/"model", content, timestamp}]` |

**ingredients** (master data)

| Field | Type | Keterangan |
|---|---|---|
| name | String | Nama bahan |
| category | String | `protein`, `karbo`, `sayur`, `bumbu` |
| sub_category | String | Sub kategori (contoh: `Protein Hewani`) |
| unit | String | Satuan default |
| common_quantity | Number | Jumlah umum |

### SQLite Tables (Primary Local Storage)

**cached_recipes**: `id, mongo_id, title, description, image_url, data_json, updated_at`

**cached_ingredients**: `id, mongo_id, name, category, sub_category, unit, common_quantity, updated_at`

**fridge_items**: `id, mongo_id, user_id, ingredient_name, category, quantity, unit, created_at, updated_at`

**favorites**: `id, mongo_id, user_id, recipe_mongo_id, recipe_data_json, created_at`

**chat_histories**: `id, user_id, messages_json, created_at, updated_at`

**sync_queue**: `id, action, collection_name, document_id, user_id, data_json, synced, created_at`

---

## Auth Flow

```
1. Register/Login → dapat JWT token
2. Simpan token di client
3. Setiap request ke endpoint yang butuh auth, kirim header:
   Authorization: Bearer <token>
4. Token berlaku 7 hari (default)
```

### Forgot Password Flow

```
1. POST /api/auth/forgot-password → kirim email OTP
2. User cek email, dapat kode 4 digit
3. POST /api/auth/verify-otp → verifikasi kode
4. POST /api/auth/reset-password → set password baru (kirim email + otp + new_password)
```

### Google/Apple Sign In Flow

```
1. Client melakukan Google/Apple Sign In via Firebase
2. Client mendapat Firebase ID token
3. POST /api/auth/google atau /api/auth/apple dengan id_token
4. Backend verifikasi token via Firebase Admin SDK
5. Backend buat/ambil user, return JWT token
```

---

## Chatbot (Gemini AI)

Chatbot SmartCook menggunakan Gemini 2.0 Flash dengan system prompt khusus sebagai asisten memasak Indonesia.

Setiap pesan ke chatbot secara otomatis menyertakan konteks:
- Profil user (alergi, riwayat penyakit, gaya masak favorit)
- Peralatan dapur yang dimiliki user
- Daftar bahan di kulkas user
- 20 pesan chat terakhir sebagai riwayat percakapan

Chatbot bisa:
- Merekomendasikan resep berdasarkan bahan yang tersedia
- Memberikan tips memasak
- Menyarankan substitusi bahan untuk alergi
- Membantu perencanaan menu harian
- Memberikan informasi nutrisi

---

## Rate Limiting

- Semua endpoint: 100 request per 15 menit per IP
- Chat endpoint: 20 request per 1 menit per IP

---

## Error Responses

Semua error menggunakan format yang sama:

```json
{
  "success": false,
  "message": "Deskripsi error"
}
```

HTTP Status Codes:
- `200` - Sukses
- `201` - Berhasil dibuat
- `400` - Bad request (validasi gagal)
- `401` - Unauthorized (token tidak valid/expired)
- `404` - Data tidak ditemukan
- `429` - Rate limit exceeded
- `500` - Server error

---

## Struktur Folder

```
smartcook-backend/
  server.js
  package.json
  .env.example
  README.md
  src/
    config/
      db.js               (MongoDB + SQLite connection)
      firebase.js          (Firebase Admin SDK)
      gemini.js            (Gemini AI client)
    middleware/
      auth.js              (JWT middleware)
      apiKey.js            (API Key validation)
      errorHandler.js      (Error handler)
    models/
      User.js
      Recipe.js
      Ingredient.js
      FridgeItem.js
      Favorite.js
      ChatHistory.js
    controllers/
      authController.js
      userController.js
      recipeController.js
      fridgeController.js
      favoriteController.js
      chatController.js
      categoryController.js
      syncController.js
    routes/
      auth.js
      user.js
      recipe.js
      fridge.js
      favorite.js
      chat.js
      category.js
      sync.js
    utils/
      otp.js
      email.js
      syncService.js       (Background sync SQLite <-> MongoDB)
    sqlite/
      offline.js           (SQLite CRUD operations)
    seed.js
  HOSTING.md               (Panduan deploy di VPS)
```
