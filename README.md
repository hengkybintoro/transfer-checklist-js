# Transfer Checklist (JavaScript)

Web sederhana untuk mencatat transfer dana per periode (event) dan memverifikasinya terhadap mutasi rekening.
**Tanpa dependensi npm, tanpa build.** Frontend berupa file statis (cocok untuk GitHub Pages) dengan dua pilihan backend:

| | **Supabase** (bawaan, disarankan) | **Node.js** (alternatif) |
|---|---|---|
| Menjalankan | frontend di GitHub Pages + database **Supabase (PostgreSQL)** | `npm start` di komputer/server Anda |
| Peserta input | langsung, entri langsung tercatat | langsung, entri langsung tercatat |
| Penyimpanan | tabel Postgres di Supabase | file JSON di server |
| Periode & tutup event | **ditegakkan database** | **ditegakkan server** |
| Login admin | **username + password di tabel `admins`** (hash bcrypt, token sesi, pembatas percobaan) | username/password di `config.json` server (cookie HttpOnly) |
| Panduan | **[SUPABASE.md](SUPABASE.md)** | bagian "Mode Node.js" di bawah |

Backend dipilih lewat `mode` di `config.js`: `'supabase'` (bawaan bila `mode` tidak diisi) atau `'server'` (dibuat otomatis oleh server Node.js).
**Login lewat `config.js` (hash password di file publik) sudah dihapus**; tidak ada lagi password atau hash admin di `config.js`.

Butuh **Node.js 20 atau lebih baru** hanya untuk mode Node.js dan untuk menjalankan tes (`node --version`).

---

## Mode Supabase (GitHub Pages + database PostgreSQL)

Frontend tetap statis, sedangkan data disimpan di Postgres milik Anda di Supabase. Peserta mengirim entri langsung ke database; admin login dengan username dan password dari tabel `admins` dan semua perubahan langsung tersimpan.

Ringkasan: (1) buat proyek Supabase, (2) jalankan `supabase/schema.sql` di SQL Editor, (3) buat pengguna admin dan daftarkan di tabel `admins`, (4) isi `supabase.url` + `supabase.anon_key` di `config.js`, (5) push. **Langkah lengkapnya ada di [SUPABASE.md](SUPABASE.md).**

Keamanan ada di database, bukan di JavaScript: pengunjung tidak punya akses langsung ke tabel, hanya ke dua fungsi (`get_published`, `submit_entry`); hanya admin yang boleh membaca/mengubah tabel (Row Level Security). Kunci `anon`/`publishable` di `config.js` memang publik, tetapi **kunci `service_role`/`secret` tidak boleh pernah ditaruh di sana** (aplikasi menolaknya).

Deploy ke GitHub Pages: **Settings → Pages → Deploy from a branch**, branch `master`, folder `/ (root)`. Tidak perlu GitHub Actions. Uji lokal: `npm run serve` lalu buka `http://localhost:8080`.

---

## Mode Node.js (alternatif tanpa Supabase)

### Mulai dalam 3 langkah

```bash
npm run init     # membuat config.json dengan password admin & secret acak (password ditampilkan sekali)
npm start        # menjalankan server
# buka http://localhost:8080  ·  admin: http://localhost:8080/#/admin
```

Mode ini menyajikan frontend yang sama dan menyimpan data di file JSON server (`<data_dir>/events/<id>.json`). Tidak ada `npm install`: tidak ada dependensi. Untuk pengembangan (restart otomatis): `npm run dev`.

### Alur pemakaian

1. Admin login di `/#/admin` → **New event** (nama, tanggal mulai dan selesai input, deskripsi/info rekening).
2. Event otomatis tampil di beranda selama periodenya terbuka. Beranda **hanya menampilkan event yang sedang aktif** (bisa beberapa sekaligus); peserta memilih salah satu. Link langsung: `/#/e/<id>`.
3. Peserta mengisi nama, nominal, tanggal transfer. Entri langsung tercatat dengan status **Pending** dan terlihat semua orang.
4. Admin membuka halaman event (tabel diurutkan menurut tanggal transfer, seperti membaca mutasi), mencocokkan dengan rekening koran, lalu menekan **Valid** atau **Invalid** (+ catatan). Tersedia juga *Add an entry manually*, *Delete*, dan *Export CSV*.
5. **Close** (di halaman event) kapan saja tanpa menunggu tanggal selesai (dan **Reopen** bila perlu). Event tertutup hilang dari beranda dan server menolak entri baru, tetapi daftarnya tetap bisa dilihat lewat link langsung.

Catatan admin hanya ditampilkan ke publik untuk entri **Invalid**; untuk status lain server tidak mengirimnya ke pengunjung.

### Konfigurasi (`config.json`)

`npm run init` membuatnya otomatis. Contoh manual ada di `config.example.json`.

| Field | Default | Keterangan |
|---|---|---|
| `listen_addr` | `:8080` | Alamat listen. Pakai `127.0.0.1:8080` bila di belakang reverse proxy. |
| `base_url` | _(kosong)_ | URL publik. Bila diawali `https://`, cookie diberi flag `Secure` dan HSTS aktif. |
| `data_dir` | `./data` | Lokasi data (relatif terhadap folder `config.json`). Berkas event ada di `<data_dir>/events/`. |
| `timezone` | `Asia/Jakarta` | Zona waktu untuk batas hari periode input. |
| `admin.username` / `admin.password` | – | Wajib. Kredensial admin (hanya ada di server, bukan di config.js). |
| `session_secret` | – | Wajib, ≥ 32 karakter acak. Menandatangani cookie sesi. Ganti = semua admin keluar. |
| `session_ttl_hours` | `12` | Masa berlaku sesi admin. |
| `trust_proxy` | `false` | Isi `true` **hanya** bila di belakang reverse proxy/tunnel, agar IP klien (untuk rate limit) dibaca dari `CF-Connecting-IP` / `X-Forwarded-For`. |

Setiap nilai bisa ditimpa environment variable: `TC_LISTEN_ADDR`, `TC_BASE_URL`, `TC_DATA_DIR`, `TC_TIMEZONE`, `TC_ADMIN_USERNAME`, `TC_ADMIN_PASSWORD`, `TC_SESSION_SECRET`, `TC_SESSION_TTL_HOURS`, `TC_TRUST_PROXY`. Server menolak start bila password/secret kosong, secret < 32 karakter, atau masih berisi nilai contoh. `config.json` sudah ada di `.gitignore`; **jangan pernah commit**.

Pilih `data_dir` di luar folder proyek untuk produksi, mis. `"data_dir": "/var/lib/transfer-checklist"`. **Backup = salin folder itu.** Setiap berkas ditulis atomik (tulis `.tmp` → fsync → rename) dan versi sebelumnya disimpan sebagai `.json.bak`.

### Menjalankan terus-menerus

Contoh dengan **pm2** (`npm i -g pm2`):

```bash
pm2 start server.js --name transfer-checklist
pm2 save && pm2 startup
```

Atau **systemd** (`/etc/systemd/system/transfer-checklist.service`):

```ini
[Unit]
Description=Transfer Checklist
After=network.target

[Service]
WorkingDirectory=/opt/transfer-checklist-js
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=transfer
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### Akses dari internet

Wajib lewat **HTTPS**. Dua cara mudah:

- **Cloudflare Tunnel** (tanpa buka port): `cloudflared tunnel --url http://localhost:8080` untuk uji coba (URL berubah tiap dijalankan), atau tunnel bernama dengan domain Anda.
- **Caddy** sebagai reverse proxy: `transfer.contoh.com { reverse_proxy 127.0.0.1:8080 }` (sertifikat otomatis).

Lalu di `config.json`: `"listen_addr": "127.0.0.1:8080"`, `"base_url": "https://transfer.contoh.com"`, `"trust_proxy": true`.

### Keamanan (mode Node.js)

Cookie sesi bertanda tangan HMAC (`HttpOnly`, `SameSite=Lax`, `Secure` bila HTTPS) · perlindungan CSRF (header khusus `X-TC-Request`, cek `Origin`, `Content-Type: application/json`) · perbandingan kredensial waktu-konstan · rate limit login (5 gagal → blokir 15 menit/IP) dan input entri (10/menit/IP) · semua input divalidasi di server dengan aturan yang sama seperti di browser · tampilan memakai text node (bukan HTML) dan CSP ketat · hanya `index.html`, `css/`, `js/` yang disajikan (config, data, dan kode server tidak bisa diunduh; path traversal ditolak) · body dibatasi 16 KB · penulisan file atomik dengan kunci per event (input serentak tidak saling menimpa) · CSV aman dari formula injection.

> Halaman publik menampilkan nama dan nominal semua entri. Pastikan para peserta setuju.

### API singkat

Semua permintaan non-GET wajib `Content-Type: application/json` dan header `X-TC-Request: 1`.

| Metode & path | Akses | Fungsi |
|---|---|---|
| `GET /healthz` | publik | cek hidup (`ok`) |
| `GET /api/events` | publik (admin melihat catatan lengkap) | semua event + `today` server |
| `POST /api/events/:id/entries` | publik, rate limit | kirim entri `{name, amount, transfer_date}` |
| `POST /api/admin/login` · `logout` | — | login/logout |
| `POST /api/admin/events` · `PUT /api/admin/events/:id` | admin | buat / ubah info event |
| `POST /api/admin/events/:id/close` · `reopen` | admin | tutup / buka kembali |
| `POST /api/admin/events/:id/entries` | admin | tambah entri manual |
| `POST /api/admin/events/:id/entries/:eid/status` | admin | `{status, note}` |
| `DELETE /api/admin/events/:id/entries/:eid` | admin | hapus entri |

### Tes

```bash
npm test     # logika, konfigurasi, klien Supabase, dan server HTTP lengkap; tanpa dependensi
```

---

## Struktur

```
index.html             halaman tunggal (router berbasis #/…)
config.js              pengaturan publik: mode, supabase.url, supabase.anon_key, timezone, session_hours
css/style.css
js/core.js             logika murni: periode, validasi, CSV, cek config (dipakai browser DAN server)
js/app.js              router
js/mode.js             pemilih backend (supabase/server) + pemanggil API
js/supabase.js         klien Supabase tanpa dependensi (REST /rpc), jalur API sama dengan server
js/session.js, api.js, storage.js, settings.js, ui.js, dom.js, datepicker.js
js/views-public.js     beranda + halaman event
js/views-admin.js      login, dashboard, form event, verifikasi
supabase/schema.sql    skema Postgres + fungsi (jalankan di SQL Editor Supabase)
SUPABASE.md            panduan setup Supabase
server.js, server/     server Node.js opsional (config.json, penyimpanan JSON, sesi, API)
test/                  core, config, server, dan klien Supabase (node --test)
```

## Format file event (mode Node.js)

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

`status`: `pending` | `valid` | `invalid`. Di mode Supabase bentuk yang sama disimpan sebagai baris tabel `events` dan `entries`.
