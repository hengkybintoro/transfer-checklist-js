# Transfer Checklist (versi JavaScript, untuk GitHub Pages)

Web sederhana untuk mencatat transfer dana per periode (event) dan memverifikasinya terhadap mutasi rekening.
**Tanpa server, tanpa database, tanpa build**: hanya HTML + CSS + JavaScript, langsung jalan di `https://<user>.github.io/<repo>/`.

> Ini versi terpisah dari versi Go (`../transfer-checklist`). Keduanya tidak saling bergantung.

## Cara kerja (baca dulu, ada batasannya)

GitHub Pages hanya menyajikan file statis, jadi **tidak ada tempat bersama untuk menyimpan data yang dikirim banyak orang**. Maka alurnya begini:

1. **Data terbit** = file JSON di repo: `data/index.json` + `data/events/<id>.json` (satu file per event). Halaman publik membacanya, jadi semua orang melihat daftar entri dan statusnya.
2. **Peserta** membuka event, mengisi nama, nominal, tanggal transfer. Entri disimpan di perangkatnya dan menghasilkan **kode kirim** (`TC1.…`). Peserta meneruskan kode itu ke admin (tombol "Kirim lewat WhatsApp" atau salin).
3. **Admin** login, menempelkan kode-kode itu ke halaman event (**Impor kode kirim**), lalu mencocokkan dengan mutasi rekening dan menandai **Valid / Tidak valid / Menunggu**.
4. Admin **menerbitkan**: unduh `<id>.json` dan `index.json`, simpan ke folder `data/`, `git commit` dan `git push`. Dalam ±1–2 menit halaman publik menampilkan status terbaru.

Data kerja admin disimpan di **browser admin** (localStorage) sampai diterbitkan. Pakai satu browser yang sama, dan terbitkan secara rutin sebagai cadangan.

## Deploy ke GitHub Pages

1. Buat repo GitHub baru (mis. `transfer-checklist-js`) lalu push isi folder ini.
   ```bash
   git init -b master
   git add .
   git commit -m "Transfer Checklist JS"
   git remote add origin https://github.com/<user>/transfer-checklist-js.git
   git push -u origin master
   ```
2. Di GitHub: **Settings → Pages → Build and deployment → Source: _Deploy from a branch_**, Branch: `master`, folder `/ (root)`, klik **Save**.
3. Tunggu ±1 menit, buka `https://<user>.github.io/transfer-checklist-js/`.

Tidak perlu GitHub Actions maupun runner. Setiap `git push` otomatis memperbarui situs.

> **Privasi:** repo publik berarti `data/` (nama dan nominal) bisa dibaca siapa saja, sama seperti halaman publiknya. Pastikan peserta setuju. Repo private memerlukan paket GitHub yang mendukung Pages privat.

## Login admin

`config.js` ikut terbit secara publik, jadi yang disimpan adalah **hash SHA-256** password, bukan password-nya.

```bash
printf '%s' 'password-anda' | shasum -a 256     # macOS / Linux
```

Salin 64 karakter hex-nya ke `config.js` → `admin.password_sha256`, dan atur `admin.username`. Selama masih berisi nilai contoh, login admin menolak masuk.

Opsi lain di `config.js`: `timezone` (default `Asia/Jakarta`), `session_hours`, `admin_whatsapp` (mis. `6281234567890`, agar tombol WhatsApp langsung ke admin), `repo_url`.

Buka `https://<user>.github.io/<repo>/#/admin`.

## Pemakaian sehari-hari

1. **Event baru** di dashboard: nama, tanggal mulai/selesai input, deskripsi (mis. info rekening). Lalu terbitkan.
2. Bagikan link beranda atau link langsung event (`…/#/e/<id>`). Beranda hanya menampilkan **event yang sedang dibuka** (bisa beberapa sekaligus): belum ditutup manual dan hari ini ada di antara tanggal mulai dan selesai.
3. Kumpulkan kode kirim, **impor**, verifikasi (tabel diurutkan menurut tanggal transfer, sama seperti membaca mutasi). Tersedia juga **Tambah entri manual** dan **Unduh CSV**.
4. **Tutup event** kapan saja tanpa menunggu tanggal selesai (dan **Buka kembali** bila perlu). Event tertutup hilang dari beranda dan tidak menerima entri, tetapi daftar entrinya tetap bisa dilihat lewat link langsung.
5. Terbitkan lagi setiap ada perubahan (lihat panel **Penerbitan** di halaman event; indikatornya menunjukkan bila ada perubahan yang belum diterbitkan).

File contoh untuk dicoba ada di `examples/arisan-contoh.json` (dashboard → **Impor file event**).

## Menjalankan di lokal

Modul ES butuh server HTTP (tidak bisa dibuka lewat `file://`):

```bash
python3 -m http.server 8080      # lalu buka http://localhost:8080
```

Tes logika (Node 20+, tanpa dependensi): `npm test`.

## Keamanan dan batasan yang perlu diketahui

- **Login admin hanyalah gerbang tampilan.** Hash password ada di `config.js` yang publik, dan siapa pun bisa membuka dashboard di browser sendiri. Itu tidak berbahaya: yang dilihat publik hanya file di `data/`, dan hanya pemilik repo yang bisa mengubahnya lewat `git push`. Karena itu: pakai password kuat dan aktifkan 2FA di akun GitHub.
- **Periode input tidak bisa dipaksakan di sisi server** (tidak ada server). Form menolak input di luar periode, tetapi pengguna yang mengubah jam perangkatnya bisa lolos. Admin melihat label **"dikirim di luar periode"** pada entri semacam itu dan menentukan sendiri.
- **Waktu input** berasal dari jam perangkat peserta, bukan jam server. Cocokkan dengan mutasi rekening, bukan dengan waktu ini.
- **Tidak ada pembatasan spam** di sisi publik; entri hanya masuk bila admin mengimpor kodenya. Entri yang sama (id sama) tidak pernah masuk dua kali, dan label **"mungkin ganda"** muncul untuk nama+nominal+tanggal yang sama.
- **Cache CDN:** setelah push, halaman publik bisa tertinggal sampai beberapa menit.
- Data dari file dan kode divalidasi ketat dan ditampilkan sebagai teks (bukan HTML). Ada Content-Security-Policy ketat, dan ekspor CSV aman dari formula injection.
- Bila butuh input langsung tanpa langkah impor, atau pembatasan periode yang tegas, itu memerlukan backend (versi Go, atau layanan seperti Firebase/Supabase/Apps Script).

## Struktur

```
index.html            halaman tunggal (router berbasis #/…)
config.js             pengaturan (publik)
css/style.css
js/core.js            logika murni: periode, validasi, kode kirim, impor, CSV (diuji)
js/app.js             router
js/views-public.js    beranda + halaman event
js/views-admin.js     login, dashboard, form event, verifikasi
js/ui.js dom.js storage.js api.js
data/index.json       daftar id event yang terbit
data/events/<id>.json satu file per event
examples/             contoh file event untuk diimpor
test/core.test.js     unit test (node --test)
```

## Format file event

```json
{
  "id": "arisan-oktober-2026",
  "name": "Arisan Oktober 2026",
  "description": "Transfer ke rekening …",
  "start_date": "2026-10-10",
  "end_date": "2026-10-31",
  "created_at": "2026-10-01T00:00:00.000Z",
  "closed_at": null,
  "closed_by": "",
  "entries": [
    { "id": "a1b2c3d4e5f60718", "name": "Andi", "amount": 500000, "transfer_date": "2026-10-12",
      "submitted_at": "2026-10-12T03:15:00.000Z", "status": "valid", "admin_note": "", "verified_at": "2026-10-13T01:00:00.000Z" }
  ]
}
```

`status`: `pending` | `valid` | `invalid`. Catatan admin hanya ditampilkan publik untuk entri `invalid`.
