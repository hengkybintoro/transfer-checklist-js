// Contoh config.js untuk MODE SUPABASE. Salin isinya ke config.js (timpa), lalu ganti dua nilai bertanda GANTI.
// File ini PUBLIK (ikut terbit di GitHub Pages). Isi hanya kunci "publishable"/"anon" — JANGAN PERNAH kunci
// "secret"/"service_role". Keamanan data dijaga oleh Row Level Security di database (supabase/schema.sql).
// Panduan lengkap: SUPABASE.md
export default {
  app_name: 'Transfer Checklist',

  mode: 'supabase',

  supabase: {
    // GANTI: Project URL, contoh https://abcdefghijklmnop.supabase.co (tanpa garis miring/path di belakangnya)
    url: 'https://guyqnipugalqjyroeovj.supabase.co',
    // GANTI: kunci publishable (diawali sb_publishable_) atau kunci anon lama (diawali eyJ...)
    anon_key: 'sb_publishable_qzxcMBtx8IUE5l-H7dnpqw_CQGaORPt',
  },

  // Zona waktu untuk tampilan jam/tanggal. Harus sama dengan app_timezone() di supabase/schema.sql
  // (bawaan keduanya Asia/Jakarta; periode input ditentukan oleh database memakai zona waktu di schema.sql).
  timezone: 'Asia/Jakarta',

  // Batas umur sesi admin di browser (jam). Setelah itu admin harus login lagi.
  session_hours: 12,

  // Opsional: tautan "Kode sumber" di footer.
  repo_url: '',
};
