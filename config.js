// Konfigurasi aplikasi. File ini PUBLIK (ikut terbit di GitHub Pages), jadi jangan taruh rahasia di sini.
// Lihat README bagian "Login admin" untuk cara membuat password_sha256.
export default {
  app_name: 'Transfer Checklist',

  // Zona waktu untuk menentukan "hari ini" saat mengecek periode input.
  timezone: 'Asia/Jakarta',

  admin: {
    username: 'irene',
    // SHA-256 dari password admin (64 karakter hex). Buat dengan:
    //   printf '%s' 'password-anda' | shasum -a 256
    // Nilai di bawah hanya contoh dan MENOLAK login sampai Anda menggantinya.
    password_sha256: 'irene710',
  },

  // Masa berlaku sesi admin di browser (jam).
  session_hours: 12,

  // Opsional: nomor WhatsApp admin (format internasional tanpa +, mis. '6281234567890').
  // Bila diisi, tombol "Kirim lewat WhatsApp" langsung membuka chat ke admin.
  admin_whatsapp: '62851233175800',

  // Opsional: tautan "Kode sumber" di footer.
  repo_url: '',
};
