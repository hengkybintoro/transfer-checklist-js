# Transfer Checklist (JavaScript)

Web sederhana untuk mencatat transfer dana per periode (event) dan memverifikasinya terhadap mutasi rekening.
**Tanpa database, tanpa dependensi npm, tanpa build.** Satu kode, dua cara menjalankan:

| | **Mode Node.js** (disarankan) | **Mode GitHub Pages** (statis) |
|---|---|---|
| Menjalankan | `npm start` di komputer/server Anda | push ke GitHub, aktifkan Pages |
| Peserta input | langsung, entri langsung tercatat | lewat *kode kirim* yang diteruskan ke admin |
| Penyimpanan | file JSON di server (`data/events/<id>.json`) | file JSON di repo (diterbitkan admin lewat `git push`) |
| Periode & tutup event | **ditegakkan server** | hanya di sisi browser |
| Login admin | sesi di server (cookie HttpOnly) | gerbang tampilan di browser |

Butuh **Node.js 20 atau lebih baru** untuk mode Node.js (`node --version`).

---

## Mode Node.js

### Mulai dalam 3 langkah

```bash
npm run init     # membuat config.json dengan password admin & secret acak (password ditampilkan sekali)
npm start        # menjalankan server
# buka http://localhost:8080  ·  admin: http://localhost:8080/#/admin
```

Tidak ada `npm install`: tidak ada dependensi. Untuk pengembangan (restart otomatis): `npm run dev`.

### Alur pemakaian

1. Admin login di `/#/admin` → **Event baru** (nama, tanggal mulai dan selesai input, deskripsi/info rekening).
2. Event otomatis tampil di beranda selama periodenya terbuka. Beranda **hanya menampilkan event yang sedang aktif** (bisa beberapa sekaligus); peserta memilih salah satu. Link langsung: `/#/e/<id>`.
3. Peserta mengisi nama, nominal, tanggal transfer. Entri langsung tercatat dengan status **Menunggu** dan terlihat semua orang.
4. Admin membuka halaman event (tabel diurutkan menurut tanggal transfer, seperti membaca mutasi), mencocokkan dengan rekening koran, lalu menekan **✓ Valid** atau **✗ Tidak valid** (+ catatan). Tersedia juga *Tambah entri manual*, *Hapus entri*, dan *Unduh CSV*.
5. **Tutup event** kapan saja tanpa menunggu tanggal selesai (dan **Buka kembali** bila perlu). Event tertutup hilang dari beranda dan server menolak entri baru, tetapi daftarnya tetap bisa dilihat lewat link langsung.

Catatan admin hanya ditampilkan ke publik untuk entri **Tidak valid**; untuk status lain server tidak mengirimnya ke pengunjung.

### Konfigurasi (`config.json`)

`npm run init` membuatnya otomatis. Contoh manual ada di `config.example.json`.

| Field | Default | Keterangan |
|---|---|---|
| `listen_addr` | `:8080` | Alamat listen. Pakai `127.0.0.1:8080` bila di belakang reverse proxy. |
| `base_url` | _(kosong)_ | URL publik. Bila diawali `https://`, cookie diberi flag `Secure` dan HSTS aktif. |
| `data_dir` | `./data` | Lokasi data (relatif terhadap folder `config.json`). Berkas event ada di `<data_dir>/events/`. |
| `timezone` | `Asia/Jakarta` | Zona waktu untuk batas hari periode input. |
| `admin.username` / `admin.password` | – | Wajib. Kredensial statis admin (hanya ada di server). |
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
npm test     # 45 tes (logika, konfigurasi, dan server HTTP lengkap), tanpa dependensi
```

---

## Mode GitHub Pages (statis)

Untuk hosting gratis tanpa server. GitHub Pages hanya menyajikan file statis sehingga **tidak ada tempat bersama untuk menyimpan data yang dikirim banyak orang**. Alurnya:

1. **Data terbit** = `data/index.json` + `data/events/<id>.json` di repo. Halaman publik membacanya.
2. **Peserta** mengisi form; entri disimpan di perangkatnya dan menghasilkan **kode kirim** (`TC1.…`) untuk diteruskan ke admin (tombol WhatsApp atau salin).
3. **Admin** login, menempelkan kode-kode itu di halaman event (**Impor kode kirim**), memverifikasi, lalu **menerbitkan**: unduh `<id>.json` dan `index.json`, simpan ke folder `data/`, `git commit` dan `git push`.

Data kerja admin tinggal di browser admin sampai diterbitkan; pakai satu browser yang sama.

### Deploy

1. Push proyek ini ke repo GitHub.
2. **Settings → Pages → Build and deployment → Source: _Deploy from a branch_**, Branch `master`, folder `/ (root)`, **Save**.
3. Buka `https://<user>.github.io/<repo>/`. Tidak perlu GitHub Actions.

Di mode ini, **`config.js` bersifat publik**. Login admin memakai hash SHA-256 password di `config.js`:

```bash
printf '%s' 'password-anda' | shasum -a 256
```

Salin hasilnya ke `admin.password_sha256` (selama masih berisi nilai contoh, login menolak). Opsi lain di `config.js`: `timezone`, `session_hours`, `admin_whatsapp` (mis. `6281234567890`), `repo_url`. Buka `…/#/admin`.

> `config.json` (mode Node.js) tidak ikut terbit karena ada di `.gitignore`, dan server tidak pernah menyajikannya.

### Batasan mode statis

- Login admin hanyalah gerbang tampilan; yang melindungi data adalah akses `git push` ke repo (aktifkan 2FA GitHub).
- Periode input tidak bisa dipaksakan di server; entri yang dikirim di luar periode diberi label *"dikirim di luar periode"* untuk dinilai admin. Waktu input berasal dari jam perangkat peserta.
- Entri baru baru tampil publik setelah admin mengimpor dan menerbitkan. CDN GitHub Pages bisa tertinggal beberapa menit.
- Repo publik berarti `data/` (nama dan nominal) dapat dibaca siapa saja.

File contoh untuk dicoba ada di `examples/arisan-contoh.json` (dashboard → **Impor file event**). Untuk uji lokal mode ini tanpa Node: `python3 -m http.server 8080`.

---

## Struktur

```
server.js              titik masuk server Node.js (--init membuat config.json)
server/config.js       muat & validasi config.json + env
server/store.js        penyimpanan JSON atomik dengan kunci per event
server/auth.js         sesi HMAC, perbandingan waktu-konstan, rate limiter
server/app.js          handler HTTP: file statis + API JSON
index.html             halaman tunggal (router berbasis #/…)
config.js              pengaturan mode statis (publik); server membuat versinya sendiri
css/style.css
js/core.js             logika murni: periode, validasi, kode kirim, CSV (dipakai browser DAN server)
js/app.js              router            js/mode.js, session.js, api.js   mode server/statis
js/views-public.js     beranda + halaman event
js/views-admin.js      login, dashboard, form event, verifikasi
data/                  data event (mode Node.js menulis di sini; mode statis membaca dari sini)
examples/              contoh file event
test/                  core, config, dan server (node --test)
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

`status`: `pending` | `valid` | `invalid`. Format ini sama untuk kedua mode, jadi data dari server bisa langsung diterbitkan ke GitHub Pages dan sebaliknya.
