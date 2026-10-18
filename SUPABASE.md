# Panduan Setup Supabase

Mode Supabase membuat aplikasi ini bisa memakai **database PostgreSQL** sambil tetap di-hosting di **GitHub Pages**.
Frontend (HTML/JS) tetap file statis; semua data (event, entri, status verifikasi) disimpan di Supabase.

```
Browser (GitHub Pages)  ──HTTPS──▶  Supabase
  peserta : memanggil fungsi get_published() dan submit_entry()        (tanpa login, tanpa akses tabel)
  admin   : login username + password (tabel admins) → token sesi      (tabel tidak bisa diakses langsung; semua lewat fungsi)
```

Peserta **langsung tercatat**, admin **tidak perlu unduh/commit JSON**, periode input dan penutupan event **ditegakkan database**
(bukan jam browser), dan login admin **memakai username dan password di tabel `admins`** yang diperiksa database. Supabase Auth (login email) tidak dipakai. Login lama lewat `config.js` sudah dihapus.

Perkiraan waktu: 15–20 menit. Anda sudah punya organisasi dan proyek Supabase, jadi mulai dari langkah 1.

---

## Langkah 1 — Ambil URL dan kunci proyek

Buka proyek Anda di <https://supabase.com/dashboard>, lalu:

1. **Project URL**: tombol **Connect** di bagian atas proyek, atau **Project Settings → Data API / API**. Bentuknya `https://abcdefghijklmnop.supabase.co`.
2. **Kunci publik**: **Project Settings → API Keys**. Ambil salah satu:
   - **Publishable key** (diawali `sb_publishable_…`) — disarankan, atau
   - **anon key** lama (tab *Legacy API Keys*, string panjang diawali `eyJ…`). Keduanya bekerja.

> **Jangan pernah** memakai kunci **secret** (`sb_secret_…`) atau **service_role** di aplikasi ini. Kunci itu melewati semua pengaman database.
> Karena `config.js` publik, aplikasi akan menolak bekerja bila mendeteksi kunci semacam itu.

Catat dua nilai ini; dipakai di langkah 4.

## Langkah 2 — Buat tabel dan aturan keamanan (`supabase/schema.sql`)

1. Di dashboard: **SQL Editor → New query**.
2. Buka file `supabase/schema.sql` di repo ini, **salin seluruh isinya**, tempel ke editor.
3. Klik **Run**. Hasil yang benar: *Success. No rows returned*.

Skrip ini membuat tabel `admins` (kolom `username` dan `password_hash`), `admin_sessions`, `login_failures`, `events`, `entries`, `rate_limits`; mengaktifkan Row Level Security tanpa kebijakan apa pun (tabel tertutup untuk API); dan membuat fungsi `get_published()`, `submit_entry()`, `admin_login()` serta fungsi `admin_*` untuk aksi admin.
Skrip **aman dijalankan ulang** (data event dan entri tidak dihapus); jalankan ulang setiap kali Anda memperbarui `schema.sql` dari repo.

> **Bila sebelumnya Anda memakai versi dengan Supabase Auth:** tabel `admins` lama (yang berisi `user_id`) otomatis diganti dengan tabel baru bernama sama. **Data `events` dan `entries` tetap utuh.** Buat admin lagi di langkah 3.

Cek: **Table Editor** menampilkan semua tabel dengan label *RLS enabled*. Bila Table Editor memperingatkan “no policies”, itu memang disengaja: tabel hanya boleh disentuh fungsi di atas.

**Zona waktu.** Periode input dihitung database memakai zona waktu di fungsi `app_timezone()` (bawaan `Asia/Jakarta`).
Bila Anda butuh zona lain, ganti `'Asia/Jakarta'` di bagian atas `schema.sql`, jalankan ulang, dan samakan `timezone` di `config.js`.

## Langkah 3 — Buat akun admin (username + password)

Di **SQL Editor**, jalankan (ganti username dan passwordnya):

```sql
select public.create_admin('irene', 'password-kuat-anda');
```

- Username: 3–60 karakter; huruf kecil, angka, titik, garis bawah, strip, atau `@`. Huruf besar otomatis dijadikan kecil, jadi `Irene` dan `irene` sama.
- Password: minimal 8 karakter. Pilih yang panjang dan unik.

Cek: `select username, created_at, last_login_at from public.admins;` menampilkan 1 baris.

**Password tidak disimpan polos.** Kolom `password_hash` berisi hash bcrypt (`$2a$12$…`), sehingga isi tabel tidak bisa dibaca kembali menjadi password. Aplikasi memeriksa password lewat fungsi `admin_login()` di database; browser hanya menerima token sesi acak (berlaku 12 jam) dan tidak pernah menerima hash.

> **Catatan privasi.** Password yang Anda ketik di `create_admin(...)` ikut tercatat di *Query history* SQL Editor. Hapus riwayatnya (atau ganti password lewat `set_admin_password` dari query baru yang tidak Anda simpan) bila itu mengganggu. Jangan menaruh password asli di file yang masuk ke git.

Mengelola admin (semuanya hanya bisa dari SQL Editor, tidak bisa dipanggil lewat API):

```sql
select public.create_admin('budi', 'password-lain');          -- tambah admin
select public.set_admin_password('irene', 'password-baru');   -- ganti password (semua sesi irene otomatis keluar)
select public.remove_admin('budi');                            -- hapus admin (sesinya ikut hilang)
select username, created_at, last_login_at from public.admins; -- daftar admin
```

Perlindungan login: setelah **5 kali gagal dari satu IP dalam 15 menit** login diblokir sementara (juga untuk password yang benar), dan **20 kali gagal terhadap satu username** diblokir lintas IP. Pesan galatnya sama untuk username yang salah maupun password yang salah.

Supabase Auth (menu **Authentication**) tidak lagi dipakai. Anda tidak perlu membuat pengguna di sana, dan pengaturan *Allow new users to sign up* tidak berpengaruh pada aplikasi ini.

## Langkah 4 — Sesuaikan `config.js`

Buka `config.js` di repo Anda dan ubah menjadi seperti di bawah.
**Yang wajib diganti hanya `url` dan `anon_key`.**

```js
export default {
  app_name: 'Transfer Checklist',

  mode: 'supabase',                                  // backend Supabase (juga bawaan bila baris ini dihapus)

  supabase: {
    url: 'https://abcdefghijklmnop.supabase.co',     // ← GANTI: Project URL (tanpa "/" atau path di belakangnya)
    anon_key: 'sb_publishable_xxxxxxxxxxxxxxxx',     // ← GANTI: publishable/anon key (BUKAN secret/service_role)
  },

  timezone: 'Asia/Jakarta',                          // samakan dengan app_timezone() di schema.sql
  session_hours: 12,                                 // lama sesi admin di browser sebelum harus login lagi
  repo_url: '',                                      // opsional: tautan "Kode sumber" di footer
};
```

| Kunci | Wajib? | Keterangan |
|---|---|---|
| `mode` | disarankan | `'supabase'` (juga bawaan bila dikosongkan). |
| `supabase.url` | ya | Project URL dari langkah 1. Harus `https://…` (`http://` hanya diizinkan untuk `localhost`). |
| `supabase.anon_key` | ya | Kunci publishable/anon. Kunci rahasia ditolak otomatis. |
| `timezone` | disarankan | Untuk tampilan tanggal/jam. Samakan dengan `app_timezone()` di SQL. |
| `session_hours` | tidak | Bawaan 12. |
| `repo_url` | tidak | Tautan footer. |
| `admin`, `admin_whatsapp` | **sudah tidak ada** | Login lewat `config.js` dihapus. Bila masih ada di file Anda, hapus saja (diabaikan; hash password sebaiknya tidak dipublikasikan). Login admin memakai username + password dari langkah 3. |

**Bila Anda memakai domain kustom Supabase atau Supabase self-hosted** (alamatnya bukan `*.supabase.co`): ubah juga `connect-src` pada tag `<meta http-equiv="Content-Security-Policy">` di `index.html`,
misalnya `connect-src 'self' https://db.domain-anda.com;`. Tanpa itu browser memblokir permintaan ke Supabase.

## Langkah 5 — Coba di komputer sendiri (opsional)

```bash
npm run serve      # = python3 -m http.server 8080
# buka http://localhost:8080
```

Pastikan `config.js` sudah diisi. Beranda tampil "Belum ada event yang sedang dibuka" bila semuanya benar.
Login di `http://localhost:8080/#/admin` memakai **username + password** dari langkah 3.

## Langkah 6 — Deploy ke GitHub Pages

```bash
git add -A
git commit -m "Pakai Supabase"
git push
```

Tunggu ±1–2 menit, lalu muat ulang paksa (Cmd/Ctrl+Shift+R). Aplikasi memuat `config.js` dengan parameter waktu, jadi perubahan config biasanya terbaca dalam ±1 menit.

Pengaturan Pages: Deploy from a branch → `master` / root.

## Langkah 7 — Uji cepat

1. Buka situs → beranda kosong (belum ada event).
2. `/#/admin` → login dengan username admin → **Event baru** (pilih tanggal dari kalender; tanggal mulai hari ini).
3. Buka beranda di jendela *private* → event tampil → isi nama, nominal, tanggal → entri muncul berstatus **Menunggu**.
4. Kembali ke admin → buka event → **✓ Valid** / **✗ Tidak valid** (+ catatan). Muat ulang halaman publik: status terlihat; catatan hanya tampil untuk *Tidak valid*.
5. **Tutup event** → hilang dari beranda dan peserta tidak bisa mengirim lagi.

---

## Yang bisa dan tidak bisa dilakukan pengunjung

| Pihak | Boleh | Tidak boleh |
|---|---|---|
| Pengunjung (tanpa login) | Membaca event + entri (catatan admin hanya untuk status *tidak valid*); menambah entri **Menunggu** lewat `submit_entry()` | Membaca/ubah tabel langsung; mengubah status; menghapus; melihat username admin |
| Admin (punya token sesi dari `admin_login`) | Membuat/ubah/tutup event, menambah/memverifikasi/menghapus entri, melihat semua catatan, lewat fungsi `admin_*` | Mengelola akun admin (hanya SQL Editor) |
| Siapa pun | — | Membaca/ubah tabel secara langsung (RLS aktif tanpa kebijakan, hak tabel dicabut) |

Aturan yang dijaga **di database** (tidak bisa dilewati dengan mengutak-atik JavaScript): event harus ada dan sedang dibuka menurut tanggal & status tutup, nama 1–80 karakter tanpa karakter kontrol, nominal 1 – 1 triliun, tanggal transfer tidak di masa depan, maksimal 5000 entri per event, dan **10 input per menit per IP**.

Batasan yang perlu diketahui: entri publik tidak memakai captcha, jadi seseorang masih bisa mengirim data palsu dalam batas laju di atas. Itu sebabnya setiap entri berstatus **Menunggu** sampai admin mencocokkannya dengan mutasi rekening; entri spam bisa dihapus admin satu per satu.

## Pemecahan masalah

| Pesan / gejala | Penyebab dan solusi |
|---|---|
| “Konfigurasi Supabase belum diisi” / “supabase.url belum diisi” | `config.js` belum berisi `supabase.url`/`anon_key`, atau belum di-push/belum ter-refresh (muat ulang paksa). |
| “Kunci Supabase (anon_key) ditolak” | Kunci salah salin atau dari proyek lain. Ambil ulang di **Project Settings → API Keys**. |
| “JANGAN memakai kunci rahasia …” | Anda memasukkan `service_role`/`secret`. Ganti dengan publishable/anon, dan **putar (rotate) kunci rahasia itu** di dashboard bila sudah sempat ter-push. |
| “Database Supabase belum disiapkan …” | `schema.sql` belum dijalankan (atau gagal). Jalankan ulang di SQL Editor. Pastikan juga **Data API** proyek aktif dan skema `public` terekspos. Bila baru menjalankan skema, tunggu beberapa detik atau jalankan `notify pgrst, 'reload schema';`. |
| “Username atau password salah” | Cek username dan password. Lupa password: jalankan `select public.set_admin_password('username', 'password-baru');` di SQL Editor. Cek juga `select username from public.admins;`: bila kosong, jalankan `create_admin` (langkah 3). |
| “Terlalu banyak percobaan gagal” | Diblokir sementara oleh pembatas login (5 gagal per IP / 15 menit). Tunggu ±15 menit, atau bersihkan: `truncate public.login_failures;` |
| “Database Supabase belum disiapkan atau masih versi lama” / “Akses ditolak oleh database” | Skema versi lama atau belum dijalankan. Jalankan ulang **seluruh** `supabase/schema.sql` terbaru di SQL Editor, tunggu beberapa detik (atau `notify pgrst, 'reload schema';`), lalu muat ulang paksa. |
| `schema.sql` gagal pada `create extension pgcrypto` / “crypt does not exist” | pgcrypto harus aktif. Dashboard: **Database → Extensions →** aktifkan `pgcrypto` (skema `extensions`), lalu jalankan ulang skrip. |
| Sesi admin berakhir sendiri | Sesi berlaku 12 jam, atau password diganti / admin dihapus (semua sesi dicabut). Login lagi. |
| “Terlalu banyak input” | Batas 10 input/menit/IP. Tunggu semenit. Peserta di jaringan yang sama (satu IP publik) berbagi batas ini. |
| Konsol browser: “Refused to connect … Content Security Policy” | Alamat Supabase bukan `*.supabase.co`; ubah `connect-src` di `index.html` (lihat langkah 4). |
| Tidak ada yang berubah setelah push | Cache GitHub Pages ±1–10 menit. Muat ulang paksa (Cmd/Ctrl+Shift+R). |
| Data tidak muncul / error mendadak pada proyek gratis | Proyek paket gratis dapat otomatis dijeda bila lama tidak aktif; buka dashboard dan pulihkan (*Restore*) proyek. Cek ketentuan terbaru di halaman harga Supabase. |

## Pemeliharaan

- **Memperbarui skema**: tempel ulang `supabase/schema.sql` ke SQL Editor dan Run (aman).
- **Ganti password admin**: `select public.set_admin_password('username', 'password-baru');` (lihat langkah 3).
- **Cadangan data**: dashboard **Database → Backups** (ketersediaan tergantung paket) atau ekspor tabel `events` dan `entries` ke CSV dari **Table Editor**.
- **Hapus semua data uji**: `truncate public.entries, public.events cascade;`
- **Pindah dari mode Node.js ke Supabase**: data lama berupa file JSON per event (`data/events/*.json`) tidak otomatis terbawa. Bila Anda punya data yang perlu dipindahkan, tanyakan; skrip impor sekali-jalan mudah dibuat.

## Rancangan teknis singkat

- `js/supabase.js` memanggil fungsi database lewat REST PostgREST (`/rest/v1/rpc/...`) dengan `fetch` (tanpa library). Hanya header `apikey` yang dikirim.
- Login: `admin_login(username, password)` membandingkan password dengan hash bcrypt, lalu membuat token acak 32 byte. Yang disimpan di database hanya **SHA-256 dari token**, bukan token-nya. Browser menyimpan token di `localStorage` (maksimal `session_hours`, paling lama 12 jam sesuai server). Setiap fungsi `admin_*` menerima token itu sebagai argumen `p_token` dan memeriksanya lagi; token tidak sah menghasilkan HTTP 401 dan aplikasi kembali ke halaman login.
- Karena token ada di `localStorage`, jaga agar situs tidak memuat skrip pihak ketiga (CSP di `index.html` sudah membatasi ini) dan jangan membuka situs admin di komputer bersama.
- Halaman tidak tahu backend yang dipakai: `js/mode.js` meneruskan jalur API yang sama dengan server Node.js ke `js/supabase.js`.
- Kunci publishable/anon **bukan rahasia**. Yang melindungi data adalah hak akses di `supabase/schema.sql`: tabel tidak bisa diakses lewat API sama sekali, dan hanya fungsi yang disebut di atas yang boleh dipanggil. Fungsi pengelola admin (`create_admin`, `set_admin_password`, `remove_admin`) tidak bisa dipanggil lewat API.
- Username admin disimpan di `events.closed_by` saat menutup event, tetapi `get_published()` tidak pernah mengirimkannya ke publik.
