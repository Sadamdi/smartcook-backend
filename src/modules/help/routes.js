"use strict";

/**
 * FAQ + support contact.
 *
 * Served from the server (not bundled in the APK) so wording can be fixed
 * without shipping a release. Every entry carries both an Indonesian and an
 * English text: the app picks one based on the device language, and a
 * hand-edited translation is always better reviewed than a machine guess in
 * a screen that mentions account deletion or an OTP code.
 */
const express = require("express");

const router = express.Router();

const CATEGORIES = ["Umum", "Akun", "Resep", "Kulkas", "Asisten", "Aplikasi"];

const FAQ = [
  {
    id: "apa-smartcook",
    category: "Umum",
    question: "Apa itu SmartCook?",
    question_en: "What is SmartCook?",
    answer:
      "SmartCook adalah asisten masak yang membantu kamu menemukan resep sesuai bahan yang ada di kulkasmu, menyimpan resep favorit, dan menjawab pertanyaan tentang dapur.",
    answer_en:
      "SmartCook is a cooking assistant that helps you find recipes based on the ingredients in your fridge, save favourites, and answer cooking questions.",
  },
  {
    id: "cari-resep",
    category: "Resep",
    question: "Bagaimana cara mencari resep?",
    question_en: "How do I search for recipes?",
    answer:
      "Buka tab Search, lalu ketik nama bahan misalnya 'ayam'. SmartCook menampilkan resep yang cocok, dan kamu bisa menyimpan yang Favorite.",
    answer_en:
      "Open the Search tab and type an ingredient, for example 'chicken'. SmartCook shows matching recipes and you can save the ones you like.",
  },
  {
    id: "smartchef",
    category: "Asisten",
    question: "Apa itu SmartChef?",
    question_en: "What is SmartChef?",
    answer:
      "SmartChef adalah asisten di dalam aplikasi. Kamu bisa bertanya apa saja tentang masak, mulai dari ide menu sampai langkah memasak, dan jawabannya bisa diubah pendek.",
    answer_en:
      "SmartChef is the assistant inside the app. Ask it anything about cooking, from meal ideas to step-by-step methods, and it streams the answer as it writes.",
  },
  {
    id: "kulkas",
    category: "Kulkas",
    question: "Bagaimana cara mengisi kulkas?",
    question_en: "How do I fill my fridge?",
    answer:
      "Di halaman utama, pilih Tambah Bahan. Pilih kategorinya, isi jumlah dan satuannya, lalu tekan simpan. Semakin lengkap datanya, semakin akurat resep yang muncul.",
    answer_en:
      "On the home screen tap Tambah Bahan. Pick a category, enter the amount and unit, then save. The more complete your data, the better the matching recipes.",
  },
  {
    id: "bahan-kurang",
    category: "Kulkas",
    question: "Apa itu tombol Cari Bahan yang Kurang?",
    question_en: 'What does "Cari Bahan yang Kurang" do?',
    answer:
      "Saat kamu membuka sebuah resep, tombol itu menambahkan semua bahan resep yang belum ada di kulkasmu sekaligus.",
    answer_en:
      "When you open a recipe, this button adds every ingredient from it that you do not already have in your fridge.",
  },
  {
    id: "alergi",
    category: "Akun",
    question: "Apakah SmartCook menghindari bahan yang bikin alergi?",
    question_en: "Does SmartCook avoid allergens?",
    answer:
      "Bisa. Masukkan alergi dan riwayat penyakit di Edit preferensi, lalu rekomendasi dan hasil pencarian akan menghindari bahan tersebut.",
    answer_en:
      "Yes. Add your allergies and medical history under Edit preferensi, and recommendations and search results will avoid those ingredients.",
  },
  {
    id: "daftar",
    category: "Akun",
    question: "Bagaimana cara mendaftar?",
    question_en: "How do I register?",
    answer:
      "Buka aplikasi, pilih Daftar, lalu isi nama, email, dan password. Kamu juga bisa mendaftar lewat tombol Google.",
    answer_en:
      "Open the app, choose Daftar, then fill in your name, email, and password. You can also register with the Google button.",
  },
  {
    id: "lupa-password",
    category: "Akun",
    question: "Saya lupa password, bagaimana?",
    question_en: "I forgot my password, what now?",
    answer:
      "Di halaman Masuk, pilih Lupa Password dan masukkan email akunmu. Kode OTP dikirim ke email tersebut untuk membuat password baru.",
    answer_en:
      "On the sign-in screen choose Lupa Password and enter your email. An OTP is sent there so you can set a new password.",
  },
  {
    id: "ganti-email",
    category: "Akun",
    question: "Bagaimana cara mengganti email?",
    question_en: "How do I change my email?",
    answer:
      "Buka Profil lalu pilih Ganti email. Kode OTP dikirim ke email lama untuk memastikan kamu pemilik akun.",
    answer_en:
      "Open Profil and choose Ganti email. An OTP is sent to your current address to confirm you own the account.",
  },
  {
    id: "hapus-akun",
    category: "Akun",
    question: "Bagaimana cara menghapus akun?",
    question_en: "How do I delete my account?",
    answer:
      "Buka Profil, scroll ke bagian Bahaya, lalu pilih Hapus Akun. Kamu akan diminta mengetik HAPUS lalu memasukkan kode OTP dari email akunmu. Setelah itu akun dan seluruh datanya dihapus permanen dan tidak bisa dipulihkan.",
    answer_en:
      "Open Profil, scroll to the Danger section and choose Hapus Akun. You must type HAPUS and enter the OTP sent to your email. Your account and all its data are then permanently deleted and cannot be restored.",
  },
  {
    id: "update-aplikasi",
    category: "Aplikasi",
    question: "Bagaimana cara memperbarui aplikasi?",
    question_en: "How do I update the app?",
    answer:
      "Saat ada versi baru, aplikasi menampilkan pemberitahuan saat dibuka. Tekan Update, unduhan berjalan di dalam aplikasi dan dilanjutkan otomatis bila internet terputus. Riwayat rilis bisa dilihat di Profil pada bagian Versi Aplikasi.",
    answer_en:
      "When a new version is out, the app shows a notice on launch. Tap Update; the download runs inside the app and resumes automatically if the connection drops. Release history is under Profil, Versi Aplikasi.",
  },
  {
    id: "apk-resmi",
    category: "Aplikasi",
    question: "Kenapa aplikasi(update) ditolak?",
    question_en: "Why is the update rejected?",
    answer:
      "Aplikasi hanya menerima pembaruan dari versi resmi yang ditandatangani sertifikat developers yang sama. Kalau muncul peringatan ini, pasang ulang dari sumber resmi yang kamu pakai sebelumnya.",
    answer_en:
      "The app only accepts updates from the official build, which is signed with the release certificate. If you see this warning, reinstall from the same official source.",
  },
];

const TOPICS = CATEGORIES.map((c) => ({ id: c.toLowerCase(), label: c }));

router.get("/faq", (req, res) => {
  const { category, q } = req.query || {};
  let items = FAQ;
  if (category) {
    const needle = String(category).toLowerCase();
    items = items.filter((f) => f.category.toLowerCase() === needle);
  }
  if (q) {
    const needle = String(q).toLowerCase();
    items = items.filter(
      (f) =>
        f.question.toLowerCase().includes(needle) ||
        f.question_en.toLowerCase().includes(needle) ||
        f.answer.toLowerCase().includes(needle) ||
        f.answer_en.toLowerCase().includes(needle)
    );
  }
  res.json({
    success: true,
    data: { items, total: items.length, topics: TOPICS },
  });
});

// Contact details come from the environment so they can change without a
// release; a missing value simply means the app hides that button.
router.get("/contact", (_req, res) => {
  const pick = (key) => {
    const value = process.env[key];
    return value && value.trim() ? value.trim() : null;
  };
  res.json({
    success: true,
    data: {
      email: pick("SUPPORT_EMAIL"),
      whatsapp: pick("SUPPORT_WHATSAPP"),
      hours: pick("SUPPORT_HOURS"),
    },
  });
});

module.exports = router;
