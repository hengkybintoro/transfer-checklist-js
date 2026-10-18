-- =====================================================================================
-- Transfer Checklist — skema database Supabase (PostgreSQL), versi 2
--
-- Cara pakai: Supabase Dashboard -> SQL Editor -> New query -> tempel SELURUH isi file ini -> Run.
-- Aman dijalankan ulang (idempotent). Aman juga dijalankan di atas skema versi 1 (lihat "MIGRASI" di bawah).
--
-- Model keamanan (penting dibaca):
--   * TIDAK ADA akses langsung ke tabel untuk siapa pun lewat API (anon maupun authenticated). Semua akses lewat fungsi:
--       get_published()   -> publik: event + entri (catatan admin hanya terlihat bila status "tidak valid")
--       submit_entry()    -> publik: tambah entri "pending" (divalidasi + dibatasi laju per IP)
--       admin_login()     -> cek username + password (hash bcrypt di tabel admins), mengembalikan token sesi
--       admin_*()         -> operasi admin; semua WAJIB membawa token sesi yang sah
--   * Login admin memakai tabel public.admins (username + password_hash). Password disimpan sebagai hash bcrypt,
--     BUKAN teks polos. Token sesi acak (256 bit), hanya hash-nya yang disimpan, berlaku 12 jam.
--   * Percobaan login gagal dibatasi: 5 gagal / 15 menit per IP (dan 20 / 15 menit per username).
--   * Kunci "anon"/"publishable" di config.js memang publik; yang melindungi data adalah fungsi di bawah ini.
--     JANGAN PERNAH menaruh kunci "service_role"/"secret" di config.js.
--
-- MIGRASI dari versi 1 (login lewat Supabase Auth): tabel admins lama (user_id) DIHAPUS dan dibuat ulang dengan
-- username + password_hash; policy RLS lama dibuang. Data event dan entri TIDAK disentuh. Setelah menjalankan skrip ini,
-- buat admin baru dengan:   select public.create_admin('username-anda', 'password-kuat-anda');
-- =====================================================================================

-- pgcrypto (bcrypt + acak aman). Di Supabase sudah ada di schema "extensions".
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- zona waktu aplikasi ----------
-- Dipakai untuk menentukan "hari ini" (periode input event). Samakan dengan "timezone" di config.js.
create or replace function public.app_timezone() returns text
language sql immutable set search_path = ''
as $$ select 'Asia/Jakarta'::text $$;

create or replace function public.app_today() returns date
language sql stable set search_path = ''
as $$ select (now() at time zone public.app_timezone())::date $$;

-- ---------- migrasi: buang admins versi 1 (berbasis Supabase Auth) ----------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'admins' and column_name = 'user_id') then
    drop table public.admins cascade;
  end if;
end $$;

-- ---------- tabel ----------
create table if not exists public.admins (
  id            uuid primary key default gen_random_uuid(),
  username      text not null check (username ~ '^[a-z0-9._@-]{3,60}$'),
  password_hash text not null,                         -- hash bcrypt, bukan password asli
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
create unique index if not exists admins_username_key on public.admins (username);

create table if not exists public.admin_sessions (
  token_hash text primary key,                         -- sha256 dari token; token asli tidak disimpan
  admin_id   uuid not null references public.admins (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists admin_sessions_admin_idx on public.admin_sessions (admin_id);
create index if not exists admin_sessions_exp_idx on public.admin_sessions (expires_at);

create table if not exists public.login_failures (
  id       bigint generated always as identity primary key,
  ip       text not null,
  username text not null,
  at       timestamptz not null default now()
);
create index if not exists login_failures_ip_idx on public.login_failures (ip, at);
create index if not exists login_failures_user_idx on public.login_failures (username, at);

create table if not exists public.events (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  name        text not null check (char_length(name) between 1 and 100 and name !~ '[\r\n]'),
  description text not null default '' check (char_length(description) <= 1000),
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,                      -- terisi = ditutup manual oleh admin
  closed_by   text not null default '' check (char_length(closed_by) <= 120),
  constraint events_period_ok check (end_date >= start_date)
);

create table if not exists public.entries (
  id           text primary key
               default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
               check (id ~ '^[a-f0-9]{16}$'),
  event_id     text not null references public.events (id) on delete cascade on update cascade,
  name         text not null check (char_length(name) between 1 and 80),
  amount       bigint not null check (amount > 0 and amount <= 1000000000000),
  transfer_date date not null,
  submitted_at timestamptz not null default now(),
  status       text not null default 'pending' check (status in ('pending', 'valid', 'invalid')),
  admin_note   text not null default '' check (char_length(admin_note) <= 200),
  verified_at  timestamptz
);
create index if not exists entries_event_idx on public.entries (event_id, submitted_at);

-- pembatas laju input publik (per IP per menit); hanya diakses fungsi submit_entry
create table if not exists public.rate_limits (
  ip     text not null,
  minute timestamptz not null,
  n      integer not null default 0,
  primary key (ip, minute)
);
create index if not exists rate_limits_minute_idx on public.rate_limits (minute);

-- ---------- trigger ----------
create or replace function public.entries_before_insert() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select count(*) from public.entries x where x.event_id = new.event_id) >= 5000 then
    raise exception 'Jumlah entri event ini sudah mencapai batas.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists entries_before_insert on public.entries;
create trigger entries_before_insert before insert on public.entries
  for each row execute function public.entries_before_insert();

-- verified_at diatur otomatis di server saat status/catatan diubah (bukan dari jam browser)
create or replace function public.entries_before_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status is distinct from old.status or new.admin_note is distinct from old.admin_note then
    new.verified_at := case when new.status = 'pending' then null else now() end;
  end if;
  return new;
end $$;

drop trigger if exists entries_before_update on public.entries;
create trigger entries_before_update before update on public.entries
  for each row execute function public.entries_before_update();

-- ---------- Row Level Security: semua tabel tertutup untuk API (tanpa policy) ----------
alter table public.admins         enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.login_failures enable row level security;
alter table public.rate_limits    enable row level security;
alter table public.events         enable row level security;
alter table public.entries        enable row level security;

-- policy versi 1 (berbasis is_admin()) dibuang
drop policy if exists events_admin_all on public.events;
drop policy if exists entries_admin_all on public.entries;
drop function if exists public.is_admin();

revoke all on public.admins, public.admin_sessions, public.login_failures, public.rate_limits,
              public.events, public.entries from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

-- ---------- fungsi internal (tidak bisa dipanggil lewat API) ----------

create or replace function public._client_ip() returns text
language plpgsql stable set search_path = ''
as $$
declare
  v_hdr jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
begin
  -- cf-connecting-ip diisi Cloudflare di depan Supabase
  return left(coalesce(nullif(btrim(v_hdr ->> 'cf-connecting-ip'), ''),
                       nullif(btrim(split_part(coalesce(v_hdr ->> 'x-forwarded-for', ''), ',', 1)), ''),
                       'unknown'), 64);
end $$;

-- Memvalidasi token sesi; mengembalikan admin atau melempar galat 401 (PT401).
create or replace function public._admin_from_token(p_token text) returns public.admins
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_a public.admins;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Sesi admin tidak valid atau sudah berakhir. Silakan login lagi.' using errcode = 'PT401';
  end if;
  select a.* into v_a
    from public.admin_sessions s join public.admins a on a.id = s.admin_id
   where s.token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex') and s.expires_at > now();
  if not found then
    raise exception 'Sesi admin tidak valid atau sudah berakhir. Silakan login lagi.' using errcode = 'PT401';
  end if;
  return v_a;
end $$;

-- Satu event + entrinya sebagai JSON. p_admin=false: catatan hanya untuk "invalid", closed_by dikosongkan.
create or replace function public._event_json(p_id text, p_admin boolean) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'description', e.description,
    'start_date', e.start_date, 'end_date', e.end_date,
    'created_at', e.created_at, 'closed_at', e.closed_at,
    'closed_by', case when p_admin then e.closed_by else '' end,
    'entries', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.id, 'name', x.name, 'amount', x.amount, 'transfer_date', x.transfer_date,
          'submitted_at', x.submitted_at, 'status', x.status,
          'admin_note', case when p_admin or x.status = 'invalid' then x.admin_note else '' end,
          'verified_at', x.verified_at)
        order by x.submitted_at, x.id)
      from public.entries x where x.event_id = e.id), '[]'::jsonb))
  from public.events e where e.id = p_id
$$;

-- Validasi bersama untuk entri (publik dan admin). Mengembalikan nama yang sudah dirapikan.
create or replace function public._check_entry(p_name text, p_amount bigint, p_date date) returns text
language plpgsql stable set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if v_name = '' then
    raise exception 'Nama wajib diisi.' using errcode = 'P0001';
  elsif char_length(v_name) > 80 then
    raise exception 'Nama maksimal 80 karakter.' using errcode = 'P0001';
  elsif v_name ~ '[[:cntrl:]]' then
    raise exception 'Nama mengandung karakter yang tidak diizinkan.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal harus lebih dari 0.' using errcode = 'P0001';
  elsif p_amount > 1000000000000 then
    raise exception 'Nominal terlalu besar.' using errcode = 'P0001';
  end if;
  if p_date is null then
    raise exception 'Tanggal transfer tidak valid.' using errcode = 'P0001';
  elsif p_date > public.app_today() then
    raise exception 'Tanggal transfer tidak boleh di masa depan.' using errcode = 'P0001';
  end if;
  return v_name;
end $$;

-- Validasi info event.
create or replace function public._check_event(p_name text, p_description text, p_start date, p_end date) returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' then raise exception 'Nama event wajib diisi.' using errcode = 'P0001'; end if;
  if char_length(v_name) > 100 then raise exception 'Nama event maksimal 100 karakter.' using errcode = 'P0001'; end if;
  if v_name ~ '[\r\n]' then raise exception 'Nama event harus satu baris.' using errcode = 'P0001'; end if;
  if char_length(coalesce(p_description, '')) > 1000 then raise exception 'Deskripsi maksimal 1000 karakter.' using errcode = 'P0001'; end if;
  if p_start is null then raise exception 'Tanggal mulai tidak valid.' using errcode = 'P0001'; end if;
  if p_end is null then raise exception 'Tanggal selesai tidak valid.' using errcode = 'P0001'; end if;
  if p_end < p_start then raise exception 'Tanggal selesai tidak boleh sebelum tanggal mulai.' using errcode = 'P0001'; end if;
  return v_name;
end $$;

-- ---------- API publik ----------

-- Semua event + entri untuk pengunjung.
create or replace function public.get_published() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'today', public.app_today(),
    'events', coalesce((select jsonb_agg(public._event_json(e.id, false) order by e.end_date, e.name) from public.events e), '[]'::jsonb))
$$;

-- Peserta mencatat transfer. Semua aturan diperiksa di sini (bukan di browser).
create or replace function public.submit_entry(p_event_id text, p_name text, p_amount bigint, p_transfer_date date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := public.app_today();
  v_ev    public.events;
  v_name  text;
  v_ip    text := public._client_ip();
  v_n     integer;
  v_row   public.entries;
begin
  -- pembatas laju: maksimal 10 input / menit / IP
  if random() < 0.05 then
    delete from public.rate_limits where minute < now() - interval '1 hour';
  end if;
  insert into public.rate_limits as r (ip, minute, n)
    values (v_ip, date_trunc('minute', now()), 1)
    on conflict (ip, minute) do update set n = r.n + 1
    returning r.n into v_n;
  if v_n > 10 then
    raise exception 'Terlalu banyak input. Coba lagi sebentar lagi.' using errcode = 'P0001';
  end if;

  select * into v_ev from public.events where id = p_event_id;
  if not found then
    raise exception 'Event tidak ditemukan.' using errcode = 'P0001';
  end if;
  if v_ev.closed_at is not null then
    raise exception 'Event ini sudah ditutup oleh admin, input tidak bisa dikirim lagi.' using errcode = 'P0001';
  elsif v_today < v_ev.start_date then
    raise exception 'Event ini belum dibuka.' using errcode = 'P0001';
  elsif v_today > v_ev.end_date then
    raise exception 'Periode input event ini sudah berakhir.' using errcode = 'P0001';
  end if;

  v_name := public._check_entry(p_name, p_amount, p_transfer_date);

  insert into public.entries (event_id, name, amount, transfer_date)
    values (p_event_id, v_name, p_amount, p_transfer_date)
    returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'amount', v_row.amount, 'transfer_date', v_row.transfer_date,
    'submitted_at', v_row.submitted_at, 'status', v_row.status, 'admin_note', '', 'verified_at', null);
end $$;

-- ---------- login admin ----------

-- Mengembalikan {ok:true, token, username, expires_at} atau {ok:false, error}.
-- (Kegagalan dikembalikan sebagai nilai, bukan galat, agar pencatatan percobaan gagal tidak ikut dibatalkan.)
create or replace function public.admin_login(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user  text := lower(btrim(coalesce(p_username, '')));
  v_pass  text := coalesce(p_password, '');
  v_ip    text := public._client_ip();
  v_a     public.admins;
  v_ok    boolean := false;
  v_token text;
  v_exp   timestamptz := now() + interval '12 hours';
begin
  if random() < 0.05 then
    delete from public.login_failures where at < now() - interval '1 day';
    delete from public.admin_sessions where expires_at < now();
  end if;

  if (select count(*) from public.login_failures where ip = v_ip and at > now() - interval '15 minutes') >= 5
     or (select count(*) from public.login_failures where username = left(v_user, 60) and at > now() - interval '15 minutes') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'Terlalu banyak percobaan gagal. Coba lagi dalam beberapa menit.');
  end if;

  if char_length(v_user) between 3 and 60 and char_length(v_pass) between 1 and 200 then
    select * into v_a from public.admins where username = v_user;
    if found then
      v_ok := v_a.password_hash = extensions.crypt(v_pass, v_a.password_hash);
    else
      perform extensions.crypt(v_pass, extensions.gen_salt('bf', 12)); -- samakan waktu proses agar username tak bisa ditebak
    end if;
  end if;

  if not v_ok then
    insert into public.login_failures (ip, username) values (v_ip, left(v_user, 60));
    return jsonb_build_object('ok', false, 'error', 'Username atau password salah.');
  end if;

  delete from public.login_failures where ip = v_ip and username = v_user;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.admin_sessions (token_hash, admin_id, expires_at)
    values (encode(sha256(convert_to(v_token, 'utf8')), 'hex'), v_a.id, v_exp);
  update public.admins set last_login_at = now() where id = v_a.id;
  return jsonb_build_object('ok', true, 'token', v_token, 'username', v_a.username,
                            'expires_at', extract(epoch from v_exp)::bigint);
end $$;

create or replace function public.admin_session(p_token text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_a public.admins := public._admin_from_token(p_token);
begin
  return jsonb_build_object('username', v_a.username);
end $$;

create or replace function public.admin_logout(p_token text) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.admin_sessions where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  return true;
end $$;

-- ---------- operasi admin (semua wajib token sesi) ----------

create or replace function public.admin_list(p_token text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public._admin_from_token(p_token);
  return jsonb_build_object(
    'today', public.app_today(),
    'events', coalesce((select jsonb_agg(public._event_json(e.id, true) order by e.end_date, e.name) from public.events e), '[]'::jsonb));
end $$;

create or replace function public.admin_create_event(p_token text, p_id text, p_name text, p_description text, p_start_date date, p_end_date date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  perform public._admin_from_token(p_token);
  v_name := public._check_event(p_name, p_description, p_start_date, p_end_date);
  if p_id is null or p_id !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception 'ID event tidak valid.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.events where id = p_id) then
    raise exception 'ID event sudah dipakai. Coba lagi.' using errcode = 'P0001';
  end if;
  insert into public.events (id, name, description, start_date, end_date)
    values (p_id, v_name, btrim(coalesce(p_description, '')), p_start_date, p_end_date);
  return public._event_json(p_id, true);
end $$;

create or replace function public.admin_update_event(p_token text, p_id text, p_name text, p_description text, p_start_date date, p_end_date date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  perform public._admin_from_token(p_token);
  v_name := public._check_event(p_name, p_description, p_start_date, p_end_date);
  update public.events
     set name = v_name, description = btrim(coalesce(p_description, '')), start_date = p_start_date, end_date = p_end_date
   where id = p_id;
  if not found then raise exception 'Event tidak ditemukan.' using errcode = 'P0001'; end if;
  return public._event_json(p_id, true);
end $$;

create or replace function public.admin_set_closed(p_token text, p_id text, p_closed boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_a public.admins := public._admin_from_token(p_token);
begin
  update public.events
     set closed_at = case when p_closed then now() else null end,
         closed_by = case when p_closed then v_a.username else '' end
   where id = p_id;
  if not found then raise exception 'Event tidak ditemukan.' using errcode = 'P0001'; end if;
  return public._event_json(p_id, true);
end $$;

create or replace function public.admin_add_entry(p_token text, p_event_id text, p_name text, p_amount bigint, p_transfer_date date)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  perform public._admin_from_token(p_token);
  if not exists (select 1 from public.events where id = p_event_id) then
    raise exception 'Event tidak ditemukan.' using errcode = 'P0001';
  end if;
  v_name := public._check_entry(p_name, p_amount, p_transfer_date);
  insert into public.entries (event_id, name, amount, transfer_date) values (p_event_id, v_name, p_amount, p_transfer_date);
  return public._event_json(p_event_id, true);
end $$;

create or replace function public.admin_set_status(p_token text, p_event_id text, p_entry_id text, p_status text, p_note text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_note text := btrim(replace(coalesce(p_note, ''), E'\r\n', E'\n'));
begin
  perform public._admin_from_token(p_token);
  if p_status is null or p_status not in ('pending', 'valid', 'invalid') then
    raise exception 'Status tidak dikenal.' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 200 then raise exception 'Catatan maksimal 200 karakter.' using errcode = 'P0001'; end if;
  if v_note ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception 'Catatan mengandung karakter yang tidak diizinkan.' using errcode = 'P0001'; end if;
  update public.entries set status = p_status, admin_note = v_note where id = p_entry_id and event_id = p_event_id;
  if not found then raise exception 'Entri tidak ditemukan.' using errcode = 'P0001'; end if;
  return public._event_json(p_event_id, true);
end $$;

create or replace function public.admin_delete_entry(p_token text, p_event_id text, p_entry_id text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._admin_from_token(p_token);
  delete from public.entries where id = p_entry_id and event_id = p_event_id;
  if not found then raise exception 'Entri tidak ditemukan.' using errcode = 'P0001'; end if;
  return public._event_json(p_event_id, true);
end $$;

-- ---------- kelola admin (HANYA dari SQL Editor; tidak bisa dipanggil lewat API) ----------

-- select public.create_admin('irene', 'password-kuat-anda');
create or replace function public.create_admin(p_username text, p_password text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user text := lower(btrim(coalesce(p_username, '')));
begin
  if v_user !~ '^[a-z0-9._@-]{3,60}$' then
    raise exception 'Username harus 3-60 karakter: huruf kecil, angka, titik, garis bawah, strip, atau @.';
  end if;
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'Password minimal 8 karakter.';
  end if;
  if exists (select 1 from public.admins where username = v_user) then
    raise exception 'Username "%" sudah ada. Pakai set_admin_password() untuk mengganti password.', v_user;
  end if;
  insert into public.admins (username, password_hash) values (v_user, extensions.crypt(p_password, extensions.gen_salt('bf', 12)));
  return 'Admin "' || v_user || '" dibuat.';
end $$;

-- select public.set_admin_password('irene', 'password-baru');   (semua sesi admin itu otomatis dikeluarkan)
create or replace function public.set_admin_password(p_username text, p_password text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user text := lower(btrim(coalesce(p_username, '')));
  v_id   uuid;
begin
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'Password minimal 8 karakter.';
  end if;
  update public.admins set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 12))
   where username = v_user returning id into v_id;
  if v_id is null then raise exception 'Username "%" tidak ditemukan.', v_user; end if;
  delete from public.admin_sessions where admin_id = v_id;
  delete from public.login_failures where username = v_user;
  return 'Password "' || v_user || '" diganti.';
end $$;

-- select public.remove_admin('irene');
create or replace function public.remove_admin(p_username text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user text := lower(btrim(coalesce(p_username, '')));
begin
  delete from public.admins where username = v_user;
  if not found then raise exception 'Username "%" tidak ditemukan.', v_user; end if;
  return 'Admin "' || v_user || '" dihapus.';
end $$;

-- ---------- hak eksekusi fungsi: cabut semua, beri hanya yang perlu ----------
do $$
declare
  f text;
begin
  foreach f in array array[
    'app_timezone()', 'app_today()', '_client_ip()', '_admin_from_token(text)', '_event_json(text,boolean)',
    '_check_entry(text,bigint,date)', '_check_event(text,text,date,date)',
    'entries_before_insert()', 'entries_before_update()',
    'get_published()', 'submit_entry(text,text,bigint,date)',
    'admin_login(text,text)', 'admin_session(text)', 'admin_logout(text)', 'admin_list(text)',
    'admin_create_event(text,text,text,text,date,date)', 'admin_update_event(text,text,text,text,date,date)',
    'admin_set_closed(text,text,boolean)', 'admin_add_entry(text,text,text,bigint,date)',
    'admin_set_status(text,text,text,text,text)', 'admin_delete_entry(text,text,text)',
    'create_admin(text,text)', 'set_admin_password(text,text)', 'remove_admin(text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'app_timezone()', 'app_today()', 'get_published()', 'submit_entry(text,text,bigint,date)',
    'admin_login(text,text)', 'admin_session(text)', 'admin_logout(text)', 'admin_list(text)',
    'admin_create_event(text,text,text,text,date,date)', 'admin_update_event(text,text,text,text,date,date)',
    'admin_set_closed(text,text,boolean)', 'admin_add_entry(text,text,text,bigint,date)',
    'admin_set_status(text,text,text,text,text)', 'admin_delete_entry(text,text,text)'
  ] loop
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- Beri tahu PostgREST agar memuat ulang skema segera
notify pgrst, 'reload schema';

-- =====================================================================================
-- LANGKAH BERIKUTNYA: buat admin pertama (jalankan di SQL Editor, ganti nilainya):
--
--   select public.create_admin('irene', 'password-kuat-anda');
--
-- Cek: select username, created_at, last_login_at from public.admins;
-- =====================================================================================
